import {parseWageInput,validateWageDecision} from './wageRules.ts';
import {discardKind} from './payrollPacketDiscard.ts';
const id='00000000-0000-4000-8000-000000000001', employee='00000000-0000-4000-8000-000000000002',revision='00000000-0000-4000-8000-000000000003';
export function examples(){
  const cases=[];const row={changeId:id,employeeId:employee,revision,status:'pending'};
  const decision={action:'approve',changeId:id,employeeId:employee,revision,confirmed:true};
  for(const [scenario,roles,rev] of [['Authorized approval',['Workforce.Admin'],revision],['Wrong role',['Workforce.Caregiver'],revision],['Stale revision',['Workforce.Admin'],'00000000-0000-4000-8000-000000000004']]){
    try{const input=parseWageInput({...decision,revision:rev});validateWageDecision(row,input,'fictional-actor',roles);cases.push({scenario,status:200,meaning:'Rules allow a later store operation; no SQL write occurred'});}catch(error){cases.push({scenario,status:error.status,message:error.message});}
  }
  const base={lines:[],unapproved:[],paymentSetups:[],secureDetails:[]};
  return {fixture:true,cases,draftHistory:{empty:discardKind([JSON.stringify(base)]),earlierMeaningfulVersion:discardKind([JSON.stringify({...base,lines:[{}]}),JSON.stringify(base)]),unknownShape:discardKind(['{}'])},databaseOpened:false,tokenVerified:false};
}
console.log(JSON.stringify(examples(),null,2));
