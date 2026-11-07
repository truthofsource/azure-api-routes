import {validatePayPeriodCycle,validateEntries,calculateTotals,parsePaging} from '../.local/timesheetRules.mjs';
import {parsePublicEmploymentApplication} from '../.local/publicEmploymentApplication.mjs';
import {createValidSubmission} from '../.local/fixture.mjs';
const entries=[{workDate:'2026-06-22',serviceType:'regular',timeIn1:'09:00',timeOut1:'17:00'}];
validatePayPeriodCycle('2026-06-21','2026-07-04');
const validated=validateEntries(entries,'2026-06-21','2026-07-04');
const applicant=parsePublicEmploymentApplication(createValidSubmission());
console.log(JSON.stringify({scope:'Fictional source-validator demonstration',timesheetTotals:calculateTotals(validated,'2026-06-21'),paging:parsePaging({url:'http://localhost/api/mytimesheets?pageSize=200'}),applicationParsed:Boolean(applicant),realAuthentication:false,sqlWrites:0,emails:0},null,2));
