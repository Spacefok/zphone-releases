export function createMotion(root) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),animations=new Set();
  let previous={},leaving=null;
  const animate=(element,frames,duration=190)=>{
    if(!element||reduced.matches||document.hidden||!element.animate)return;
    const animation=element.animate(frames,{duration,easing:'cubic-bezier(.2,.7,.2,1)'});
    animations.add(animation);animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));
    return animation;
  };
  reduced.addEventListener('change',()=>{if(reduced.matches){for(const animation of animations)animation.cancel();leaving?.remove();leaving=null;}});
  return {
    before(next){
      if(next.overlay!==previous.overlay){leaving?.remove();leaving=null;}
      const closing=!reduced.matches&&!next.overlay&&previous.overlay?root.querySelector('.overlay')?.cloneNode(true):null;
      return {closing};
    },
    after(next,{closing}){
      if(previous.theme&&next.theme!==previous.theme)animate(root.querySelector('.shell'),[{opacity:.65},{opacity:1}],180);
      if(next.view!==previous.view)animate(root.querySelector('main'),[{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'none'}]);
      if(next.overlay&&next.overlay!==previous.overlay){
        animate(root.querySelector('.overlay'),[{opacity:0},{opacity:1}],160);
        animate(root.querySelector('.sheet'),[{transform:'translateY(18px) scale(.985)'},{transform:'none'}],220);
      }
      if(closing){
        leaving=closing;closing.inert=true;closing.setAttribute('aria-hidden','true');closing.classList.add('overlay-leaving');root.append(closing);
        animate(closing.querySelector('.sheet'),[{transform:'none'},{transform:'translateY(12px)'}],140);
        const animation=animate(closing,[{opacity:1},{opacity:0}],140);
        if(animation)animation.finished.catch(()=>{}).finally(()=>{closing.remove();if(leaving===closing)leaving=null;});else closing.remove();
      }
      if(next.message&&next.message!==previous.message)animate(root.querySelector('.notice'),[{opacity:0,transform:'translate(-50%, 8px)'},{opacity:1,transform:'translate(-50%, 0)'}]);
      if(next.status!==previous.status&&previous.status&&next.view==='home'){
        animate(root.querySelector('.connection-state'),[{opacity:.55},{opacity:1}]);
        animate(root.querySelector('.power'),[{transform:'scale(.96)'},{transform:'scale(1)'}],220);
      }
      for(const key of ['startWithWindows','startInTray'])if(previous[key]!==undefined&&next[key]!==previous[key]){
        animate(root.querySelector(`[data-setting="${key}"] + .switch-track .switch-thumb`),[{transform:`translateX(${previous[key]?18:0}px)`},{transform:`translateX(${next[key]?18:0}px)`}],180);
      }
      const spinner=root.querySelector('.power .lucide-loader-circle');
      if(spinner)spinner.style.animationDelay=-(performance.now()%1300)+'ms';
      previous={...next};
    }
  };
}
