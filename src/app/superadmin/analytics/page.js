'use client';
import { useState, useEffect } from 'react';
import saApi from '@/lib/saApi';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#F97316', '#EF4444', '#8B5CF6', '#3B82F6', '#10B981'];

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    saApi.getAnalytics(days)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { daily = [], topRestaurants = [], planDist = [] } = data || {};

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Analytics</h1>
          <p className="text-sa-500 text-sm mt-1">Platform-wide performance data</p>
        </div>
        <div className="flex gap-1 bg-sa-900 border border-sa-700 rounded-xl p-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${days === d ? 'bg-orange-500 text-white' : 'text-sa-400 hover:text-white'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <div className="bg-sa-900 border border-sa-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-1">Daily Orders</h2>
          <p className="text-xs text-sa-500 mb-5">Order volume (last {days} days)</p>
          {daily.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sa-600 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#525252' }} axisLine={false} tickLine={false} tickFormatter={s => s.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: '#525252' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#171717', border: '1px solid #262626', borderRadius: 12, color: '#fff' }} />
                <Bar dataKey="orders" fill="#F97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan distribution */}
        <div className="bg-sa-900 border border-sa-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-5">Plan Distribution</h2>
          {planDist.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sa-600 text-sm">No data</div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="w-[140px] h-[140px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={planDist} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="count">
                      {planDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {planDist.map((p, i) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-sm text-sa-300 capitalize">{p.name}</span>
                    </div>
                    <span className="text-sm font-bold text-white">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top restaurants */}
        <div className="bg-sa-900 border border-sa-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-5">Top Restaurants by Orders</h2>
          {topRestaurants.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sa-600 text-sm">No data</div>
          ) : (
            <div className="space-y-3">
              {topRestaurants.slice(0, 6).map((r, i) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="text-xs font-black text-sa-600 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{r.name}</div>
                    <div className="h-1.5 bg-sa-800 rounded-full mt-1">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.min(100, (r.orders / (topRestaurants[0]?.orders || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-bold text-sa-400 flex-shrink-0">{r.orders}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
