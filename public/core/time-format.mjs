// Times on the page use a 24-hour clock (requested after the 2026-10-06 phone check).
// The optional timeZone is for tests; the page uses the device's own zone.
const valid=value=>{const date=new Date(value);return Number.isNaN(+date)?null:date;};
const format=(value,options,{timeZone}={})=>{const date=valid(value);return date?date.toLocaleString('ko-KR',{...options,hourCycle:'h23',...(timeZone?{timeZone}:{})}):'';};

export const formatClock=(value,zone)=>format(value,{hour:'2-digit',minute:'2-digit'},zone);
export const formatShortDateTime=(value,zone)=>format(value,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'},zone);
export const formatDateTime=(value,zone)=>format(value,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'},zone);
