export function withDeadline(task, milliseconds, parentSignal){
  const controller=new AbortController();
  let timer,abort;
  const stopped=new Promise((_,reject)=>{
    abort=()=>{
      const reason=parentSignal?.reason||Object.assign(Error('Operation cancelled'),{code:'ABORT_ERR'});
      controller.abort(reason);reject(reason);
    };
    if(parentSignal?.aborted){abort();return;}
    parentSignal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{
      const error=Object.assign(Error('Operation timed out'),{code:'ETIMEDOUT'});
      controller.abort(error);reject(error);
    },milliseconds);
  });
  // Some native transports do not settle on abort. The caller still needs a bound.
  const work=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return task(controller.signal);});
  return Promise.race([work,stopped]).finally(()=>{
    clearTimeout(timer);parentSignal?.removeEventListener('abort',abort);
  });
}
