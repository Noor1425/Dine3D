'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';

export default function ActivityLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    loadLogs();
  }, [page]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await api.getActivityLog(`limit=${limit}&offset=${page * limit}`);
      setLogs(res.audits);
      setTotal(res.total);
    } catch (err) {
      toast.error('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  };

  const getActionBadge = (action) => {
    if (action.includes('CREATE')) return 'badge-success';
    if (action.includes('DELETE')) return 'badge-danger';
    return 'badge-neutral';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Activity & Audit Log</h1>
          <div className="page-header-subtitle">Full transparency of all administrative actions</div>
        </div>
      </div>

      <div className="card animate-in">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Staff / Role</th>
                <th>Action</th>
                <th>Entity Type</th>
                <th>Details</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" textAlign="center" padding="40px">Loading activity history...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan="6" textAlign="center" padding="40px">No activity logs found.</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{log.userId?.split('-')[0]}...</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{log.userRole}</div>
                  </td>
                  <td>
                    <span className={`badge ${getActionBadge(log.action)}`} style={{ fontSize: 11 }}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{log.entityType}</td>
                  <td>
                    <div style={{ fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.newValue ? JSON.stringify(log.newValue) : log.previousValue ? `Deleted: ${JSON.stringify(log.previousValue)}` : '—'}
                    </div>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {log.ipAddress || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, padding: '0 8px' }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total} events
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              className="btn btn-ghost btn-sm" 
              disabled={page === 0} 
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button 
              className="btn btn-ghost btn-sm" 
              disabled={(page + 1) * limit >= total} 
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
