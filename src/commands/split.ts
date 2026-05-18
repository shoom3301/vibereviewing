import { join } from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { execa } from "execa"
import type { Classifier } from "../classify/classifier.js"
import type { Config } from "../config/schema.js"
import type { PRRef, Layer } from "../types.js"
import type { FileChange } from "../hunkify/types.js"
import type { PromotedClassification } from "../promote/types.js"
import { parseDiff } from "../hunkify/parse.js"
import { applyContext } from "../hunkify/context.js"
import { buildSystemPrompt } from "../classify/prompt.js"
import { classifyAll } from "../classify/batch.js"
import { promote } from "../promote/pipeline.js"
import { renderLayerPatch } from "../apply/render.js"
import { applyPatchOrEscalate } from "../apply/apply.js"
import { buildLayerCommitMessage } from "../apply/commit.js"
import { checkIntegrity } from "../apply/integrity.js"
import { renderPrBody, type PrBodyLayer, type PrBodyEscalation } from "../render/prBody.js"
import { renderOriginalPrComment } from "../render/comment.js"

const LAYERS: Layer[] = ["A", "B", "C"]
const TOOL_VERSION = "0.1.0"

export type SplitInput = {
  pr: PRRef
  diff: string
  config: Config
  classifier: Classifier
  repoPath: string
  worktreePath: string  // already created via withWorktree
  push: (branch: string) => Promise<void>
  openPR: (args: { branch: string; title: string; body: string }) => Promise<string>
  postComment: (body: string) => Promise<void>
  now?: Date
}

export type SplitResult = {
  companionUrl: string
  manifestPath: string
  perLayer: Record<Layer, number>
  escalations: PrBodyEscalation[]
}

export async function runSplit(input: SplitInput): Promise<SplitResult> {
  const files = parseDiff(input.diff)
  applyContext(files, { floors: input.config.floors, generated: input.config.generated })
  const allHunks = files.flatMap((f) => f.hunks)

  // §10: token-budget guard.
  const diffTokens = input.classifier.estimateTokens(input.diff)
  if (diffTokens > input.config.max_diff_tokens) {
    throw Object.assign(new Error(
      `PR diff is ${diffTokens} tokens; config max_diff_tokens is ${input.config.max_diff_tokens}.`),
      { exitCode: 2 })
  }

  const systemPrompt = buildSystemPrompt({ config: input.config })
  const { classifications } = await classifyAll({
    hunks: allHunks, classifier: input.classifier, systemPrompt,
    maxPerBatch: 30, maxTokensPerBatch: 30_000,
  })

  const promoted = promote({
    files, hunks: allHunks,
    classifications: new Map(classifications.map((c) => [c.hunk_id, c])),
    confidenceThreshold: input.config.confidence_threshold,
  })

  // Render and apply each layer, escalating on apply failure.
  const branch = `vibereview/pr-${input.pr.number}-${input.pr.headSha.slice(0, 7)}`
  await execa("git", ["checkout", "-q", "-b", branch], { cwd: input.worktreePath })

  // Build initial per-layer hunk sets.
  const layerSets = new Map<Layer, Set<string>>([["A", new Set()], ["B", new Set()], ["C", new Set()]])
  for (const [id, p] of promoted) layerSets.get(p.layer)!.add(id)

  const escalations: PrBodyEscalation[] = []
  for (const [, p] of promoted) {
    if (p.originalLayer !== p.layer) {
      const h = allHunks.find((x) => x.id === p.hunk_id)!
      escalations.push({
        hunkId: p.hunk_id, file: h.file, line: h.newStart,
        from: p.originalLayer, to: p.layer,
        reason: p.escalations[p.escalations.length - 1] ?? "domain_floor",
      })
    }
  }

  const layerShas: Partial<Record<Layer, string>> = {}
  for (const layer of LAYERS) {
    const hunkIds = layerSets.get(layer)!
    if (hunkIds.size === 0) continue

    let patch = renderLayerPatch(files, hunkIds)
    let result = await applyPatchOrEscalate(input.worktreePath, patch)

    // §7 escalation fallback: move rejects to the next non-empty later layer.
    let attempts = 0
    while (!result.applied && layer !== "C" && attempts < 5) {
      const nextLayerIdx = LAYERS.indexOf(layer) + 1 + attempts
      const target = LAYERS[Math.min(nextLayerIdx, 2)]!
      const toMove = rejectedHunkIds(result, files)
      for (const id of toMove) {
        hunkIds.delete(id)
        layerSets.get(target)!.add(id)
        const p = promoted.get(id)!
        escalations.push({
          hunkId: id, file: fileOf(id, files), line: lineOf(id, files),
          from: p.layer, to: target, reason: "domain_floor",
        })
      }
      patch = renderLayerPatch(files, hunkIds)
      result = await applyPatchOrEscalate(input.worktreePath, patch)
      attempts++
    }
    if (!result.applied) {
      throw new Error(`Layer ${layer} failed to apply after escalation: ${result.stderr}`)
    }
    await execa("git", ["add", "-A"], { cwd: input.worktreePath })
    const message = buildLayerCommitMessage({
      layer, sourcePR: `${input.pr.owner}/${input.pr.repo}#${input.pr.number}`,
      sourceHead: input.pr.headSha,
      hunkIds: [...hunkIds].sort(),
      toolVersion: TOOL_VERSION,
      provider: input.classifier.provider,
      model: input.classifier.model,
      generatedAt: input.now ?? new Date(),
    })
    await execa("git", ["commit", "-q", "-m", message], { cwd: input.worktreePath })
    layerShas[layer] = String(
      (await execa("git", ["rev-parse", "HEAD"], { cwd: input.worktreePath })).stdout,
    ).trim()
  }

  // Integrity check: the companion tree (all layer commits combined) must match the original PR head.
  // We run this BEFORE writing the manifest so the manifest doesn't pollute the tree comparison.
  const companionHead = String(
    (await execa("git", ["rev-parse", "HEAD"], { cwd: input.worktreePath })).stdout,
  ).trim()
  const integrity = await checkIntegrity({
    repoPath: input.worktreePath,
    baseSha: input.pr.baseSha,
    originalHead: input.pr.headSha,
    companionHead,
  })
  if (!integrity.ok) throw new Error(`Integrity check failed: ${integrity.reason}`)

  // Write the manifest as a separate metadata commit AFTER integrity check.
  const manifestDir = join(input.worktreePath, ".vibereview")
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(
    join(manifestDir, `pr-${input.pr.number}.json`),
    JSON.stringify(serializeManifest(promoted, files), null, 2),
  )
  await execa("git", ["add", ".vibereview"], { cwd: input.worktreePath })
  await execa("git", ["commit", "-q", "-m",
    `[vibereview] manifest for PR #${input.pr.number}\n\nGenerated by vibereview ${TOOL_VERSION}.`],
    { cwd: input.worktreePath })

  await input.push(branch)

  const prBodyLayers = buildPrBodyLayers(layerShas, promoted, files)

  // Open the PR. We don't know the companion number until after openPR returns.
  const companionUrl = await input.openPR({
    branch,
    title: `[vibereview] PR #${input.pr.number} — layered review (do not merge)`,
    body: renderPrBody({
      sourcePR: { owner: input.pr.owner, repo: input.pr.repo, number: input.pr.number, headSha: input.pr.headSha },
      companion: { owner: input.pr.owner, repo: input.pr.repo, number: 0 },
      layers: prBodyLayers,
      escalations,
      provenance: {
        generatedAt: input.now ?? new Date(),
        toolVersion: TOOL_VERSION,
        provider: input.classifier.provider,
        model: input.classifier.model,
      },
    }),
  })

  const cNum = parseCompanionNumber(companionUrl)
  const layerC = prBodyLayers.find((l) => l.layer === "C")
  if (layerC && layerShas.C) {
    await input.postComment(renderOriginalPrComment({
      companion: { owner: input.pr.owner, repo: input.pr.repo, number: cNum },
      layerCCommit: layerShas.C, layerCHunks: layerC.hunks, layerCFiles: layerC.files,
    }))
  }

  return {
    companionUrl,
    manifestPath: `.vibereview/pr-${input.pr.number}.json`,
    perLayer: { A: layerSets.get("A")!.size, B: layerSets.get("B")!.size, C: layerSets.get("C")!.size },
    escalations,
  }
}

function rejectedHunkIds(
  r: { rejectedHunks: { file: string; hunkHeader: string }[] },
  files: FileChange[],
): string[] {
  const out: string[] = []
  for (const rej of r.rejectedHunks) {
    const f = files.find((x) => x.file === rej.file)
    if (!f) continue
    out.push(...f.hunks.map((h) => h.id))
  }
  return out
}

function fileOf(id: string, files: FileChange[]): string {
  for (const f of files) for (const h of f.hunks) if (h.id === id) return f.file
  return "?"
}
function lineOf(id: string, files: FileChange[]): number {
  for (const f of files) for (const h of f.hunks) if (h.id === id) return h.newStart
  return 0
}

function serializeManifest(
  promoted: Map<string, PromotedClassification>,
  files: FileChange[],
) {
  return [...promoted.values()].map((p) => ({
    hunk_id: p.hunk_id,
    file: fileOf(p.hunk_id, files),
    line: lineOf(p.hunk_id, files),
    layer: p.layer,
    original_layer: p.originalLayer,
    confidence: p.confidence,
    intents: p.intents,
    rationale: p.rationale,
    escalations: p.escalations,
  }))
}

function buildPrBodyLayers(
  shas: Partial<Record<Layer, string>>,
  promoted: Map<string, PromotedClassification>,
  files: FileChange[],
): PrBodyLayer[] {
  const layers: PrBodyLayer[] = []
  for (const layer of LAYERS) {
    const sha = shas[layer]
    if (!sha) continue
    const entries = [...promoted.values()].filter((p) => p.layer === layer)
    const fileSet = new Set(entries.map((p) => fileOf(p.hunk_id, files)))
    layers.push({
      layer, commitSha: sha,
      hunks: entries.length, files: fileSet.size,
      entries: entries.map((p) => ({
        file: fileOf(p.hunk_id, files), line: lineOf(p.hunk_id, files),
        intent: p.intents[0] ?? "unknown",
        rationale: p.rationale,
      })),
    })
  }
  return layers
}

function parseCompanionNumber(url: string): number {
  return Number(url.match(/\/pull\/(\d+)/)?.[1] ?? "0")
}
