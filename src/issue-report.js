export const REPORT_CONSENT='Отправить администратору через бота служебные журналы за последние 3 минуты? Отчёт связан с вашим аккаунтом. Пароли и посещённые сайты не отправляются.';
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
