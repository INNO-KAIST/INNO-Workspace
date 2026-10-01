// Known local preflight refusal: never include prompt text or raw diagnostics.
export class ContextRetrievalRequiredError extends Error {
 constructor(){
  super('작업 이력 전달 상한 초과');
  this.name='ContextRetrievalRequiredError';
  this.code='CONTEXT_RETRIEVAL_REQUIRED';
 }
}