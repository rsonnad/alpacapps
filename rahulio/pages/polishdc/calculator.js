(() => {
 const form = document.querySelector('#economics');
 const number = (n, digits=0) => new Intl.NumberFormat('en-GB', {maximumFractionDigits:digits}).format(n);
 const money = (n, digits=0) => number(n,digits) + ' PLN';
 function update(){
  const get = name => Math.max(0, Number(form.elements[name].value) || 0);
  const gpus=Math.max(1,Math.floor(get('gpus'))), months=Math.max(1,get('months'));
  const utilization=Math.min(100,get('utilization'))/100;
  const capex=get('capex'), salvage=Math.min(capex,get('salvage'));
  const price=get('price'), fee=Math.min(100,get('fee'))/100;
  const power=get('power'), pue=Math.max(1,get('pue')), rate=get('rate');
  const fixed=get('fixed'), finance=get('finance');
  const hours=gpus*730*utilization;
  const energy=power*730*pue*rate;
  const depreciation=(capex-salvage)/months;
  const cashCost=energy+fixed+finance;
  const fullCost=cashCost+depreciation;
  const retained=hours*price*(1-fee);
  const cash=retained-cashCost;
  const profit=retained-fullCost;
  const floor=hours>0&&fee<1 ? fullCost/hours/(1-fee) : null;
  const breakEven=price>0&&fee<1 ? fullCost/(gpus*730*price*(1-fee))*100 : null;
  const show=(id,value)=>document.querySelector(id).textContent=value;
  show('#revenue',money(retained));show('#energy',money(energy));show('#cash',money(cash));
  show('#economic',money(profit));show('#floor',floor===null?'—':money(floor,2)+'/GPU-h');
  show('#breakEven',breakEven===null?'—':number(breakEven,1)+'%'+(breakEven>100?' · infeasible / niewykonalne':''));
  show('#soldHours',number(hours,0));show('#fullCost',money(fullCost));
 }
 form.addEventListener('input',update);update();
 document.querySelector('#print-page').addEventListener('click',()=>window.print());
})();
