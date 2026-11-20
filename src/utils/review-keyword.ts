export function findEvidenceRange(content: string, evidence: string) {
  const start = content.indexOf(evidence)

  if (start === -1) {
    return null
  }

  return {
    start,
    end: start + evidence.length,
  }
}
