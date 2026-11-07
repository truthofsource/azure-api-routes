import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('.local',{recursive:true});
mkdirSync('data',{recursive:true});
const parse=p=>ts.createSourceFile(p,readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);
const compile=(s)=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from "(\.\/[^"]+?)(?:\.js)?"/g,'from "$1.mjs"');
const source=parse('reference/routes/timesheets.ts');
const names=['getOptionalString','getRequiredString','getRequiredUuid','getOptionalUuid','getRequiredDate','toDateUtc','differenceInDays','isDateInRange','addDays','validatePayPeriodCycle','getBoolean','getTimesheetServiceType','normalizeTime','normalizeOptionalTime','timeToMinutes','calculateEntryHours','validateEntries','calculateTotals','parsePaging','getStatusFilter'];
const constants=['allowedStatuses','uuidPattern','datePattern','timePattern','payPeriodAnchorStartDate','payPeriodLengthDays','allowedTimesheetServiceTypes'];
const selected=source.statements.filter(n=>ts.isTypeAliasDeclaration(n)||(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>constants.includes(d.name.getText(source)))));
if(names.some(name=>!selected.some(n=>ts.isFunctionDeclaration(n)&&n.name.text===name)))throw Error('Expected validator missing');
writeFileSync('.local/timesheetRules.mjs',compile(selected.map(n=>n.getText(source)).join('\n')+'\nexport { '+names.join(',')+' };'));
for(const name of ['jobTitles','phoneNumber','publicEmploymentApplication'])writeFileSync('.local/'+name+'.mjs',compile(readFileSync('reference/contracts/'+name+'.ts','utf8')));
const testSource=parse('reference/tests/publicEmploymentApplication.test.ts');
writeFileSync('.local/application.test.mjs',compile(testSource.text));
const fixture=testSource.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createValidSubmission');
if(!fixture)throw Error('Fixture missing');
writeFileSync('.local/fixture.mjs',compile('export '+fixture.getText(testSource)));
const routes=[];
for(const p of ['timesheets','timesheetreview','timesheetcorrection','publicemploymentapplications']){
 const path='reference/routes/'+p+'.ts',sf=parse(path);
 function visit(n){
  if(ts.isCallExpression(n)&&n.expression.getText(sf)==='app.http'){
   const config=n.arguments[1];
   const prop=name=>config.properties.find(x=>x.name?.getText(sf)===name)?.initializer;
   routes.push({name:n.arguments[0].text,path:'/api/'+prop('route').text,methods:prop('methods').elements.map(x=>x.text),authLevel:prop('authLevel').text,handler:prop('handler').getText(sf),source:path});
  }ts.forEachChild(n,visit);
 }visit(sf);
}
if(routes.length!==5||routes.reduce((s,r)=>s+r.methods.length,0)!==6)throw Error('Route inventory changed');
writeFileSync('data/routes.json',JSON.stringify(routes,null,2)+'\n');
console.log('Extracted 20 source validators, original application tests, and 5 route registrations (6 method/path pairs). Full Azure handlers are reference-only.');
