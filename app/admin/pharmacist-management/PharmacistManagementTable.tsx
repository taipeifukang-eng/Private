'use client';

type PharmacistRow = {
  id: string;
  store_id: string;
  store_code: string;
  store_name: string;
  employee_code: string;
  employee_name: string;
  position: string;
  supervisor_zone: string;
  change_type: string;
  prev_store_name: string;
  prev_position: string;
};

export default function PharmacistManagementTable({
  initialRows,
}: {
  initialRows: PharmacistRow[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">督導區</th>
              <th className="px-4 py-3 text-left font-semibold">門市</th>
              <th className="px-4 py-3 text-left font-semibold">員編</th>
              <th className="px-4 py-3 text-left font-semibold">姓名</th>
              <th className="px-4 py-3 text-left font-semibold">該月職級</th>
              <th className="px-4 py-3 text-left font-semibold">上月門市</th>
              <th className="px-4 py-3 text-left font-semibold">上月職級</th>
              <th className="px-4 py-3 text-left font-semibold">變化</th>
            </tr>
          </thead>
          <tbody>
            {initialRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  查無資料
                </td>
              </tr>
            ) : (
              initialRows.map((row) => (
                <tr key={`${row.store_id}-${row.employee_code}`} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">{row.supervisor_zone}</td>
                  <td className="px-4 py-3">{row.store_code} {row.store_name}</td>
                  <td className="px-4 py-3 font-mono">{row.employee_code}</td>
                  <td className="px-4 py-3">{row.employee_name}</td>
                  <td className="px-4 py-3">
                    {row.position}
                  </td>
                  <td className="px-4 py-3">{row.prev_store_name}</td>
                  <td className="px-4 py-3">{row.prev_position}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.change_type === '無變更'
                          ? 'bg-gray-100 text-gray-700'
                          : row.change_type === '新增任職'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {row.change_type}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
