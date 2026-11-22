const X=require('xlsx');
function write(name,rows){const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.json_to_sheet(rows),'測試');X.writeFile(w,'.tmp-check/'+name+'.xlsx');}
write('vue-performance-import',[{'年月份':'2038-04','門市代號':'VW001','營業天數':26,'毛利目標':260000,'毛利實際':286000,'營業額目標':500000,'營業額實際':510000}]);
write('vue-prescription-import',[{'年月':'2038-01','門市代號':'VW001','一般箋張數':10,'一般箋點值':1.2345,'慢箋張數':100,'慢箋點值':2.3456}]);
write('vue-prescription-invalid',[{'年月':'2038-01','門市代號':'VW001','一般箋張數':-1,'慢箋張數':100}]);
write('vue-bonus-import',[{'年月份':'2038-01','門市代號':'VW001','員工代號':'VW-PARITY','姓名':'Vue 對等測試','團體獎金':5000,'單品獎金':200,'其他獎金':100,'其他獎金說明':'Vue 對等驗證'}]);
