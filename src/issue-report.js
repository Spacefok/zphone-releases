export const REPORT_CONSENT='Отправить администратору отчёт о сбое? Он будет связан с вашим аккаунтом. Пароли и история посещений не отправляются.';
export const REPORT_ACCEPTED='Отчёт принят сервером. Доставка администратору может занять время.';
export function createIssueFlow(request){
  return {
    busy:false,error:'',
    async send(){
      if(this.busy)return null;
      this.busy=true;this.error='';
      try{
        const result=await request('markIssue',{confirmed:true});
        if(result?.ok!==true||!['queued','sent'].includes(result.state)||typeof result.reportId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.reportId))throw Error('Приём отчёта не подтверждён. Повторите отправку.');
        return result;
      }catch(error){this.error=error.message;return null;}
      finally{this.busy=false;}
    }
  };
}
