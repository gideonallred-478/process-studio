import {fileURLToPath} from 'node:url';
const filmDir=fileURLToPath(new URL('.',import.meta.url));
export default async ({project,text,rect,media,frame,path})=>{
 const p=await project({dir:filmDir,size:'1920x1080',fps:24,background:'#081326'});
 const names=['capture','transcript','procedure','actions','automation','settings','site-light','site-dark','words','steps','automation-detail'];
 const assets={};for(const name of names)assets[name]=await p.add(filmDir+'assets/'+name+'.png');
 const score=await p.add(filmDir+'assets/score.wav');p.cut(score,{at:0,dur:70});
 const intro=(dur,delay=0)=>[{property:'opacity',keyframes:[{at:0,value:0},{at:delay+.65,value:1},{at:dur-.4,value:1},{at:dur,value:0}]},{property:'offsetY',from:25,to:0,at:delay,duration:.8,easing:'house'}];
 const label=(s,x,y,w,size=28,color='#b5c8e6',weight=400,animate)=>text(s,{x,y,width:w,height:size*3,fontFamily:'Inter',fontSize:size,fontWeight:weight,color,lineHeight:1.18,animate});
 p.compose([
  rect({x:0,y:0,width:1920,height:1080,fill:{kind:'linear',angle:35,stops:[{offset:0,color:'#071426'},{offset:.65,color:'#0f2544'},{offset:1,color:'#071326'}]}}),
  rect({x:1590,y:-150,width:360,height:1400,fill:'#163761',opacity:.22,animate:[{property:'offsetX',from:0,to:-500,duration:70,easing:'linear'}]}),
  label('PROCESS STUDIO',104,67,700,27,'#d5e5ff',700),
  rect({x:104,y:110,width:52,height:4,fill:'#4a8dff'}),
  label('YOUR WORK, EXPLAINED',1480,68,340,21,'#87a5cf',600),
  rect({x:104,y:1024,width:1712,height:3,fill:'#1c3555'}),
  rect({x:104,y:1024,width:1712,height:3,fill:'#5694ff',animate:[{property:'scaleX',from:0,to:1,duration:70,easing:'linear'}]})
 ],{at:0,dur:70,name:'Brand and moving blue atmosphere'});
 p.compose([
  label('A walkthrough should become',104,240,1660,42,'#aac2e5',400,intro(6)),
  label('more than a video.',104,330,1712,112,'#f0f6ff',700,intro(6,.15)),
  label('Show it once. Make it repeatable.',108,566,1512,46,'#81b1ff',600,intro(6,.3)),
  rect({x:108,y:698,width:330,height:58,radius:29,fill:'#193e70',animate:intro(6,.4)}),
  label('MEET THE STUDIO',131,712,280,19,'#c7ddff',600,intro(6,.4))
 ],{at:0,dur:6,name:'Opening promise'});
 const scenes=[
  {at:6,dur:7,tag:'01 / CAPTURE',title:'Show the work.',body:'Screen, camera, and your explanation.\nThe context stays together.',image:'capture',footer:'Recording and processing in the local edition'},
  {at:13,dur:8,tag:'02 / SOURCE',title:'Keep the words.',body:'Review the transcript.\nCorrect it before you create the process.',image:'transcript',footer:'Prepared example · demonstration content'},
  {at:21,dur:9,tag:'03 / PROCEDURE',title:'Make it\nrepeatable.',body:'A summary and editable steps.\nEach step keeps its source.',image:'steps',footer:'Prepared example · editable procedure'},
  {at:30,dur:8,tag:'04 / FOLLOW THROUGH',title:'Know what\ncomes next.',body:'Turn the explanation into\nclear follow-up actions.',image:'actions',footer:'Prepared example · action items'},
  {at:38,dur:11,tag:'05 / AUTOMATION REVIEW',title:'Find what\ncan flow.',body:'Automation. App connections.\nHuman decisions. Reviewed separately.',image:'automation',footer:'Prepared example · proposals require review'},
  {at:49,dur:8,tag:'06 / YOUR AI CHOICE',title:'Choose how\nyou think.',body:'Local Qwen, your ChatGPT connection,\nor an OpenAI API configuration.',image:'settings',footer:'AI processing in the local edition · availability depends on setup'},
  {at:57,dur:6,tag:'07 / YOUR WORKSPACE',title:'Make it yours.',body:'Light. Dark. System.\nOne calm place to work.',image:'site-dark',footer:'Real site · blue appearance system'}
 ];
 for(const s of scenes){
  const nodes=[
   label(s.tag,104,220,650,23,'#74a7ff',600,intro(s.dur)),
   label(s.title,100,290,650,80,'#f2f6ff',700,intro(s.dur,.1)),
   label(s.body,104,630,650,29,'#b7c9e3',400,intro(s.dur,.2)),
   label(s.footer,104,949,1712,22,'#8faace',400,intro(s.dur,.3)),
   frame({x:786,y:211,width:1030,height:686,layout:'none',background:'#112642',radius:25,clip:true,shadow:{y:15,blur:35,color:'#020913bb'},motion:{enter:{from:{x:50,opacity:0,scale:.96},duration:.85,easing:'house'},exit:{to:{opacity:0,y:-12},duration:.3,anchor:'end'}}},[
    media({file:assets[s.image],x:0,y:0,width:1030,height:686,fit:'contain',animate:[{property:'scale',from:1,to:1.035,at:.8,duration:s.dur-1.2,easing:'linear'}]})
   ])
  ];
  p.compose(nodes,{at:s.at,dur:s.dur,name:s.tag});
  if(s.at===13)p.compose(frame({x:930,y:211,width:720,height:686,layout:'none',background:'#112642',radius:25,clip:true,motion:{enter:{from:{opacity:0,x:20},duration:.55},exit:{to:{opacity:0},duration:.3,anchor:'end'}}},[media({file:assets['words'],x:0,y:0,width:720,height:686,fit:'contain'})]),{at:17.5,dur:3.5,name:'Reviewed transcript close-up'});
  if(s.at===38)p.compose(frame({x:786,y:211,width:1030,height:686,layout:'none',background:'#112642',radius:25,clip:true,motion:{enter:{from:{opacity:0,y:20},duration:.45},exit:{to:{opacity:0},duration:.25,anchor:'end'}}},[media({file:assets['automation-detail'],x:0,y:0,width:1030,height:686,fit:'contain'})]),{at:43.5,dur:5.5,name:'Real automation methods close-up'});
  if(s.at===57)p.compose(frame({x:786,y:211,width:1030,height:686,layout:'none',background:'#eaf2ff',radius:25,clip:true,motion:{enter:{from:{opacity:0},duration:.55},exit:{to:{opacity:0},duration:.3,anchor:'end'}}},[media({file:assets['site-light'],x:0,y:0,width:1030,height:686,fit:'contain'})]),{at:60,dur:3,name:'Light appearance'});
 }
 p.compose([
  label('PROCESS STUDIO',104,238,1712,34,'#83b3ff',600,intro(7)),
  label('Show it once.',100,335,1712,104,'#f0f6ff',700,intro(7,.1)),
  label('Make it repeatable.',100,472,1712,104,'#8bb9ff',700,intro(7,.2)),
  label('Recording becomes usable work.',108,647,1600,40,'#c2d5ef',400,intro(7,.3)),
  rect({x:108,y:780,width:840,height:75,fill:'#1b4783',radius:16,animate:intro(7,.4)}),
  label('Process Studio',138,795,795,33,'#eef5ff',600,intro(7,.4)),
  label('Explore the site. Get the local edition.',109,887,1600,27,'#b0c8e7',400,intro(7,.5))
 ],{at:63,dur:7,name:'Product closing card'});
 for(const t of [3,9,17,25,34,41,46,53,59,61.5,66.5])await p.frame(t,'renders/review-'+t+'.png');
};
