import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Auth, Data, Config } from '@ssi.developer/ssi-sdk';

dotenv.config();
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=process.env.PORT||3000;
let ssiAuth=null, ssiData=null;

async function getData(){
  if(!process.env.SSI_CLIENT_ID||!process.env.SSI_API_KEY||!process.env.SSI_API_SECRET) throw new Error('Chưa cấu hình SSI_CLIENT_ID / SSI_API_KEY / SSI_API_SECRET');
  if(!ssiData){
    const config=new Config({clientId:process.env.SSI_CLIENT_ID,apiKey:process.env.SSI_API_KEY,apiSecret:process.env.SSI_API_SECRET});
    ssiAuth=new Auth(config); await ssiAuth.authenticate(); ssiData=new Data(ssiAuth);
  }
  return ssiData;
}

const fundamentals={
 VCB:{eps:6800,bvps:47000,roe:20.1,growth:12,normalEps:6500,oneOff:0}, FPT:{eps:6500,bvps:28000,roe:27.4,growth:18,normalEps:6200,oneOff:0},
 GMD:{eps:3900,bvps:28000,roe:15.8,growth:14,normalEps:3700,oneOff:0}, VSC:{eps:2100,bvps:16000,roe:12.8,growth:15,normalEps:1900,oneOff:0},
 KSV:{eps:7800,bvps:36000,roe:22.9,growth:8,normalEps:6500,oneOff:0}, HPG:{eps:2500,bvps:21000,roe:11.5,growth:14,normalEps:2300,oneOff:0},
 MSN:{eps:4300,bvps:28000,roe:13.2,growth:12,normalEps:4000,oneOff:0}, GVR:{eps:1950,bvps:18000,roe:10.4,growth:9,normalEps:1800,oneOff:0}
};
function valuation(symbol,price){const f=fundamentals[symbol];if(!f)return null;const peCap=Math.max(8,Math.min(18,10+f.growth*.25));const pbCap=Math.max(.8,Math.min(2.8,.8+f.roe*.07));const peValue=f.normalEps*peCap/1000;const pbValue=f.bvps*pbCap/1000;const fair=.6*peValue+.4*pbValue;return{method:'60% P/E chuẩn hóa + 40% P/B-ROE',normalEps:f.normalEps,peCap,pbCap,peValue,pbValue,fairValue:fair,attractive:fair*.85,upside:price?fair/price-1:null,margin:.15};}
function jsonSafe(x){return JSON.parse(JSON.stringify(x));}
function rowsFrom(x){
  let rows=x;
  for(let i=0;i<4&&!Array.isArray(rows);i++) rows=rows?.data??rows?.items??rows?.result??rows?.ohlc??rows?.ohlcv??[];
  return Array.isArray(rows)?rows:[];
}
function normalizeBars(x){
  return rowsFrom(x).map(r=>({
    date:r.tradingDate??r.trading_date??r.TradingDate??r.date??'',
    close:Number(r.close??r.closePrice??r.close_price??r.Close??0),
    volume:Number(r.volume??r.Volume??r.totalVolume??r.total_volume??0),
    value:Number(r.value??r.Value??r.totalValue??r.total_value??0)
  })).filter(r=>Number.isFinite(r.close)&&r.close>0&&Number.isFinite(r.volume)&&r.volume>=0).sort((a,b)=>{
    const dateKey=s=>{const parts=String(s).slice(0,10).split(/[\/-]/);return parts.length===3&&parts[0].length===4?parts.join(''):parts.length===3?`${parts[2]}${parts[1].padStart(2,'0')}${parts[0].padStart(2,'0')}`:String(s)};
    return dateKey(a.date).localeCompare(dateKey(b.date));
  });
}
function rsi14(closes){
  if(closes.length<15)return null;
  let gains=0,losses=0;
  for(let i=1;i<=14;i++){const change=closes[i]-closes[i-1];gains+=Math.max(change,0);losses+=Math.max(-change,0);}
  let avgGain=gains/14,avgLoss=losses/14;
  for(let i=15;i<closes.length;i++){const change=closes[i]-closes[i-1];avgGain=(avgGain*13+Math.max(change,0))/14;avgLoss=(avgLoss*13+Math.max(-change,0))/14;}
  if(avgLoss===0)return avgGain===0?50:100;
  return 100-(100/(1+avgGain/avgLoss));
}
function technicalSignal(bars){
  if(bars.length<15)return{ready:false,reason:'Không đủ dữ liệu lịch sử (cần ít nhất 15 phiên).'};
  const closes=bars.map(x=>x.close),last=bars.length-1;
  const ma8=closes.slice(last-7,last+1).reduce((a,b)=>a+b,0)/8;
  const prevMa8=closes.slice(last-8,last).reduce((a,b)=>a+b,0)/8;
  const rsi=rsi14(closes),recent=bars.slice(-5);
  const avgVolume=recent.reduce((a,b)=>a+b.volume,0)/recent.length;
  const avgTurnover=recent.reduce((a,b)=>a+(b.value||b.close*b.volume),0)/recent.length;
  const cross=closes[last]>ma8&&closes[last-1]<=prevMa8;
  const ma8Rising=ma8>=prevMa8;
  const conditions={crossMa8:cross,ma8Rising,rsiAbove50:rsi>50,avgVolumeAbove20k:avgVolume>20000,avgTurnoverAbove5b:avgTurnover>5000000000};
  return{ready:true,passed:Object.values(conditions).every(Boolean),date:bars[last].date,close:closes[last],ma8,prevMa8,rsi14:rsi,avgVolume5:avgVolume,avgTurnover5:avgTurnover,conditions};
}

app.get('/api/status',(req,res)=>res.json({ssiConfigured:!!(process.env.SSI_CLIENT_ID&&process.env.SSI_API_KEY&&process.env.SSI_API_SECRET),fundamentalProvider:'internal-inputs',note:'Market data uses official SSI FastConnect when credentials are configured.'}));
app.get('/api/index/:id',async(req,res)=>{try{const d=await getData();const x=await d.marketData.getIndexSummary(req.params.id.toUpperCase());res.json({source:'SSI FastConnect',data:jsonSafe(x)});}catch(e){res.status(503).json({error:e.message,source:'SSI FastConnect'});}});
app.get('/api/ohlcv/:symbol',async(req,res)=>{try{const d=await getData();const days=Number(req.query.days||120);const to=new Date();const from=new Date(Date.now()-days*86400000);const fmt=x=>x.toISOString().slice(0,10).replaceAll('-','/')+' 00:00:00';const x=await d.marketData.getOhlc1dayHistorical(req.params.symbol.toUpperCase(),fmt(from),fmt(to),1,1000);res.json({source:'SSI FastConnect',data:jsonSafe(x)});}catch(e){res.status(503).json({error:e.message,source:'SSI FastConnect'});}});
app.get('/api/screener',async(req,res)=>{
  try{
    const symbols=String(req.query.symbols||'VCB,FPT,GMD,VSC,KSV,HPG,MSN,GVR').toUpperCase().split(',').map(s=>s.trim()).filter((s,i,a)=>/^[A-Z0-9]{2,10}$/.test(s)&&a.indexOf(s)===i);
    if(!symbols.length)return res.status(400).json({error:'Nhập ít nhất một mã cổ phiếu.'});
    if(symbols.length>40)return res.status(400).json({error:'Mỗi lượt chỉ lọc tối đa 40 mã.'});
    const d=await getData(),to=new Date(),from=new Date(Date.now()-180*86400000);
    const fmt=x=>x.toISOString().slice(0,10).replaceAll('-','/')+' 00:00:00';
    let cursor=0;
    const results=await Promise.all(Array.from({length:Math.min(4,symbols.length)},async()=>{
      const output=[];
      while(cursor<symbols.length){const symbol=symbols[cursor++];try{
        const history=await d.marketData.getOhlc1dayHistorical(symbol,fmt(from),fmt(to),1,1000);
        const technical=technicalSignal(normalizeBars(jsonSafe(history)));
        output.push({symbol,...technical,fundamentals:valuation(symbol,technical.close?technical.close/1000:null)});
      }catch(e){output.push({symbol,ready:false,reason:e.message});}}
      return output;
    }));
    const rows=results.flat().sort((a,b)=>Number(b.passed)-Number(a.passed)||a.symbol.localeCompare(b.symbol));
    res.json({source:'SSI FastConnect',criteria:'Cross(C, MA8) AND MA8 >= MA8[1] AND RSI(14) > 50 AND Avg Volume(5) > 20,000 AND Avg Turnover(5) > 5 tỷ',count:rows.length,passed:rows.filter(x=>x.passed).length,results:rows});
  }catch(e){res.status(503).json({error:e.message,source:'SSI FastConnect'});}
});
app.get('/api/securities',async(req,res)=>{try{const d=await getData();const x=await d.marketData.getSecuritiesInfoByBoard(req.query.exchange||'HOSE');res.json({source:'SSI FastConnect',data:jsonSafe(x)});}catch(e){res.status(503).json({error:e.message,source:'SSI FastConnect'});}});
app.get('/api/stock/:symbol',async(req,res)=>{const s=req.params.symbol.toUpperCase();try{const d=await getData();const x=await d.marketData.getSecuritiesSummary(s);res.json({source:'SSI FastConnect',symbol:s,market:jsonSafe(x),fundamentals:fundamentals[s]||null,valuation:valuation(s,null)});}catch(e){res.status(503).json({error:e.message,symbol:s,fundamentals:fundamentals[s]||null,valuation:valuation(s,null)});}});
app.get('/api/valuation/:symbol',async(req,res)=>{const s=req.params.symbol.toUpperCase();const price=Number(req.query.price||0);res.json({symbol:s,price,valuation:valuation(s,price)});});
app.use(express.static(__dirname));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));app.listen(PORT,()=>console.log(`VNStock Analytics V1: http://localhost:${PORT}`));
