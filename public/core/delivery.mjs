// Shared by subscription executors. Instructions are not proof of verification.
const checks = Object.freeze({
 writing: 'For manuscripts, reports and proposals: deliver the requested editable document; check citations against supplied evidence, headings, cross-references, tables, dates and stated constraints. Separate supported findings from assumptions and planned work. Render every page when tools are available and inspect clipping, page breaks and typography.',
 career: 'For CVs and applications: use only supplied career facts. Never invent qualifications, dates, employers, metrics or achievements. Flag missing facts for the user. Preserve editable output and inspect all rendered pages, contact details and target-specific requirements.',
 analysis: 'For analysis and Figures: verify numeric inputs, units, missingness, transformations and uncertainty; distinguish observations from fits or hypotheses. Supply reproducible code and the requested figure format with legible labels, scales, legends and units. Inspect the rendered figure and verify plotted values against calculations. Never fabricate data or use a plot as evidence of an unperformed experiment.',
 presentation: 'For presentations: provide an editable slide deck in the requested format, with a coherent audience-specific narrative and source attribution. Render and inspect every slide for overflow, overlap, contrast, reading order and font substitution. Verify that charts and numeric claims match the supplied evidence. Include speaker notes when useful or requested.',
 literature: 'For literature work: tie each substantive claim to an identifiable source and exact available evidence scope. Distinguish abstract-only, selected excerpt and full-text access. Do not invent citations or imply model training. Separate established findings, disagreements and proposed research; mark unsupported novelty claims as unverified.',
});
export function deliveryPolicy(task={}) {
 if(task.parentTaskId)return '';
 return [
  'DELIVERY AND VERIFICATION:',
  'Follow the latest user requested format and constraints; task type is a suggestion, not permission to change the deliverable. No optional research application is required.',
  checks[task.type] || 'Choose the output form that satisfies the request. Apply relevant document, figure or presentation checks if the request needs those outputs.',
  'Use available local generators and renderers without purchasing services or using paid APIs. Never relabel plain text as a binary document. If tooling is unavailable, return a clearly identified draft or alternative and state the unmet requested format.',
  'For each returned artifact, include optional checks:[{check:"specific check",status:"pass|fail|not_run",evidence:"concrete observation or why not run"}]. Use at most 20 checks, check labels up to 200 characters and evidence up to 1500. These are agent-reported observations, not independently certified results. Do not embed originals or secrets in evidence.',
  'Report checks actually performed, concrete evidence, and limitations in the final answer. Distinguish passed, failed and not run checks. Do not claim visual verification without rendering and inspection, or completion of a requested binary deliverable when only an outline exists. Preserve a concise checkpoint if further work is needed.',
 ].join('\n');
}
