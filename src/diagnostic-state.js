export function createDiagnosticFlow(request) {
  let context, generation=0, flight;
  const flow={
    result:null,
    accept(snapshot) {
      const c=snapshot.connection||{},s=snapshot.settings||{};
      const next=JSON.stringify([c.status,c.port,c.route?.location,c.route?.protocol,
        s.location,s.protocol,s.mode,s.split?.mode,s.split?.apps?.map(app=>app.id).sort(),snapshot.account?.state]);
      if(next!==context){context=next;generation++;flow.result=null;}
    },
    run() {
      if(flow.result?.running)return flight;
      const current=++generation;
      flow.result={running:true};
      flight=(async()=>{
        let result;
        try{result=await request('diagnose');}catch{}
        // A result belongs only to the connection context that started its request.
        if(current!==generation)return null;
        flow.result=result||{ok:false,message:'Проверка не завершилась.'};
        return flow.result;
      })();
      return flight;
    },
  };
  return flow;
}
