/* ─── Languages ─────────────────────────────────────────────────────────────
   Judge0 identifies languages by a numeric id, and the ids are per-instance —
   they come from `GET /languages` on the judge itself. These are the ids from
   Judge0 CE 1.13.x, which is what the plan document specifies self-hosting.

   Held here rather than fetched, deliberately: the list a RECRUITER picks from
   when authoring must be stable, because it is stored on the problem
   (`allowedLanguages`) and a problem authored against one judge should not
   silently change meaning against another. If the ids ever drift, this is the one
   place to correct — and `GET /languages` on the judge is how to check. */
export const LANGUAGES: { id: number; key: string; label: string }[] = [
  { id: 71, key: 'python', label: 'Python 3' },
  { id: 63, key: 'javascript', label: 'JavaScript (Node)' },
  { id: 62, key: 'java', label: 'Java' },
  { id: 54, key: 'cpp', label: 'C++' },
  { id: 50, key: 'c', label: 'C' },
  { id: 51, key: 'csharp', label: 'C#' },
  { id: 60, key: 'go', label: 'Go' },
  { id: 73, key: 'rust', label: 'Rust' },
  { id: 74, key: 'typescript', label: 'TypeScript' },
]

export const languageByKey = (key: string) => LANGUAGES.find((l) => l.key === key)
