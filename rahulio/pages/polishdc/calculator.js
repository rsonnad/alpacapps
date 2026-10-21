(() => {
 const form = document.querySelector('#economics');
 const format = n => new Intl.NumberFormat('en-GB', {maximumFractionDigits:0}).format(n) + ' PLN';
 function update(){
  const get = (name) => Math.max(0, Number(form.elements[name].value) || 0);
  const clients=Math.min(8, Math.floor(get('clients'))), fee=get('fee'), rate=get('rate'), power=get('power');
  form.elements.clients.value=clients;
  const energy=power*730*1.5*rate;
  const revenue=clients*fee;
  const cash=revenue-energy-30000;
  document.querySelector('#revenue').textContent=format(revenue);
  document.querySelector('#energy').textContent=format(energy);
  document.querySelector('#cash').textContent=format(cash);
  document.querySelector('#economic').textContent=format(cash-6000);
  document.querySelector('#breakEven').textContent=fee ? Math.ceil((36000+energy)/fee) : '—';
 }
 form.addEventListener('input',update);update();
 document.querySelector('#print-page').addEventListener('click',()=>window.print());
})();
