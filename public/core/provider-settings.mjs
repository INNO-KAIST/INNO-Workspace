import {ASSIGNABLE_PROVIDER_IDS,isProviderId} from './providers.mjs';
import {ConflictError,ValidationError} from './tasks.mjs';

// PRV-06: a person can turn a registered provider off. Off blocks only new executions on it
// (a direct run is refused; queued, delegated or handed-off work waits); running work finishes
// and turning it back on resumes the waiting work. At least one assignable provider (one that
// passed the conformance suite) stays on; a provider in its trial does not count. The stored
// form is {version, disabled}; a change applies only to the version it was made from.
export function normalizeProviderSettings(value){
 if(value==null)return {version:0,disabled:[]};
 if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.version)||value.version<0||!Array.isArray(value.disabled))
  throw new TypeError('Invalid stored provider settings');
 return {version:value.version,disabled:[...new Set(value.disabled.filter(isProviderId))].sort()};
}

export function nextProviderSettings(current,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError('Invalid provider settings change');
 const {disabled,expectedVersion}=input;
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==current.version)throw new ConflictError('Provider settings changed; reload and try again',current.version);
 if(!Array.isArray(disabled)||disabled.some(id=>typeof id!=='string'))throw new ValidationError('disabled must be a list of provider ids');
 if(disabled.some(id=>!isProviderId(id)))throw new ValidationError('Unknown provider in disabled list');
 const next=[...new Set(disabled)].sort();
 if(ASSIGNABLE_PROVIDER_IDS.every(id=>next.includes(id)))throw new ValidationError('At least one provider must stay on');
 return {version:current.version+1,disabled:next};
}

export const providerEnabled=(settings,id)=>!(settings?.disabled??[]).includes(id);

export function providerDisabledError(currentVersion){
 return Object.assign(new ConflictError('이 실행기는 사용 중지 상태입니다. 연결 앱의 AI 실행기에서 다시 켜면 실행할 수 있습니다.',currentVersion),{code:'PROVIDER_DISABLED'});
}
