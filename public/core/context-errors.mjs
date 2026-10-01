// Known local preflight refusal: never include prompt text or raw diagnostics.
export class ContextRetrievalRequiredError extends Error {
 constructor(){
  super('문맥 추가 조회 필요');
  this.name='ContextRetrievalRequiredError';
  this.code='CONTEXT_RETRIEVAL_REQUIRED';
 }
}