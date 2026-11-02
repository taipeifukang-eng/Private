/** Export the currently scoped calendar only. Clone preserves Vue scoped styles and Chinese text. */
export async function exportActivityCalendar(source:HTMLElement,name:string){
 const [{default:html2canvas},{jsPDF}]=await Promise.all([import('html2canvas'),import('jspdf')]);
 const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a3'});
 const months=Array.from(source.querySelectorAll<HTMLElement>('.calendar-month'));
 if(!months.length)throw Error('No calendar');
 const stage=document.createElement('div');
 Object.assign(stage.style,{position:'fixed',left:'-20000px',top:'0',width:'1150px',padding:'24px',background:'#fff',color:'#17211a',fontFamily:'Arial,"Microsoft JhengHei",sans-serif',boxSizing:'border-box'});
 document.body.appendChild(stage);
 try{
  await document.fonts.ready;
  for(let i=0;i<months.length;i++){
   stage.replaceChildren();const title=document.createElement('h2');title.textContent=name;title.style.fontSize='20px';stage.append(title);
   const legend=source.querySelector('.legend');if(legend)stage.append(legend.cloneNode(true));
   const month=months[i].cloneNode(true) as HTMLElement;stage.append(month);
   const scroll=month.querySelector<HTMLElement>('.calendar-scroll');if(scroll)scroll.style.overflow='visible';
   const canvas=await html2canvas(stage,{backgroundColor:'#ffffff',scale:2,logging:false,windowWidth:1500});
   if(i)pdf.addPage();const w=400,h=w*canvas.height/canvas.width,scale=Math.min(1,277/h);
   pdf.addImage(canvas.toDataURL('image/png'),'PNG',10,10,w*scale,h*scale);
  }
  pdf.save(name.replace(/[\\/:*?"<>|]/g,'_')+'-活動排程.pdf');
 }finally{stage.remove();}
}
