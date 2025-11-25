import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  LogOut, LayoutDashboard, Users, FileText, Search, 
  Trash2, ChevronDown, ChevronUp, UserPlus 
} from 'lucide-react';

// === 子组件：用户文档列表 ===
function UserDocuments({ userId, userToken, onDocumentDelete, onAdminRegister }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get(`http://localhost:3001/api/admin/users/${userId}/docs`, {
    })
    .then(res => setDocs(res.data))
    .catch(e => alert("加载用户文档列表失败"))
    .finally(() => setLoading(false));
  }, [userId, userToken]);

  const handleDeleteDoc = async (docId) => {
    if (!confirm("确定要删除此文档吗？用户的聊天记录也将被删除。")) return;
    try {
      await axios.delete(`http://localhost:3001/api/admin/documents/${docId}`, {
      });
      setDocs(prev => prev.filter(d => d.id !== docId));
      onDocumentDelete(); // 通知父组件更新统计
    } catch (e) {
      alert("文档删除失败");
    }
  };
  
  // 注册管理员弹窗
  const handleRegisterAdmin = () => {
    const email = prompt("请输入新管理员的邮箱:");
    if (!email) return;
    const password = prompt("请输入新管理员的密码 (至少8位):");
    if (!password || password.length < 8) {
      alert("密码无效或长度不足8位。");
      return;
    }
    onAdminRegister(email, password);
  }

  if (loading) return <div className="p-4 text-gray-500">加载中...</div>;

  return (
    <div className="p-4 bg-gray-50 border-t border-gray-100">
      <h4 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
        <FileText className="w-4 h-4"/>
        该用户上传的文档 ({docs.length})
      </h4>
      {docs.length === 0 ? (
        <p className="text-sm text-gray-500">该用户尚未上传任何文档。</p>
      ) : (
        <ul className="space-y-2">
          {docs.map(doc => (
            <li key={doc.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
              <div className="text-sm">
                <p className="font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-500">{new Date(doc.createdAt).toLocaleDateString()} ({doc.originalName})</p>
              </div>
              <button 
                onClick={() => handleDeleteDoc(doc.id)} 
                className="text-red-400 hover:text-red-600 p-1 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// === 主组件：管理员后台 ===
export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedUser, setExpandedUser] = useState(null);
  
  // 这是一个简单状态，用于触发数据刷新 (比如删除文档后)
  const [refreshKey, setRefreshKey] = useState(0); 
  
  // 1. 获取用户列表 (带搜索)
  const fetchUsers = async () => {
    setLoading(true);
    try {
      // 🚨 接口修正: 调用新的 /api/admin/users 接口
      const res = await axios.get(`http://localhost:3001/api/admin/users`, {
        params: { search: searchQuery } // 传递搜索参数
      });
      setUsers(res.data);
    } catch (e) {
      alert("无法加载用户列表，可能是登录过期或权限不足。");
      console.error(e);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [user.token, searchQuery, refreshKey]); // 依赖项加入搜索和刷新键

  // 2. 删除用户
  const handleDeleteUser = async (userId) => {
    if (!confirm("⚠️ 警告：确定要删除此用户吗？该用户所有文档和聊天记录将被永久删除！")) return;
    try {
      await axios.delete(`http://localhost:3001/api/admin/users/${userId}`, {
      });
      alert("用户已删除。");
      setRefreshKey(prev => prev + 1); // 触发刷新
      setExpandedUser(null);
    } catch (e) {
      alert("删除用户失败");
    }
  };

  // 3. 注册新管理员
  const handleRegisterAdmin = async (email, password) => {
    try {
      await axios.post('http://localhost:3001/api/admin/register-admin', { email, password }, {
      });
      alert(`新管理员 ${email} 已创建成功！`);
      setRefreshKey(prev => prev + 1);
    } catch (e) {
      alert(e.response?.data?.error || "注册失败，可能是邮箱已存在或网络错误。");
    }
  };

  const totalDocs = users.reduce((sum, u) => sum + u._count.documents, 0);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <header className="flex justify-between items-center mb-8 max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-800">
          <LayoutDashboard className="w-7 h-7"/> 管理员后台
        </h1>
        <div className="flex items-center gap-4">
            {user.email === 'admin@test.com' && (
                <button 
                onClick={() => setExpandedUser('admin-register')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                <UserPlus className="w-4 h-4" /> 注册新管理员
                </button>
            )}
            <span className="text-gray-600">管理员: {user.email}</span>
            <button onClick={logout} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <LogOut className="w-4 h-4" /> 退出
          </button>
        </div>
      </header>

      {/* 注册新管理员 modal */}
      {expandedUser === 'admin-register' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-xl w-full max-w-sm shadow-2xl">
                <h3 className="text-lg font-bold mb-4">注册新管理员</h3>
                <input id="admin-email" placeholder="邮箱" className="w-full p-2 border rounded mb-2" />
                <input id="admin-password" type="password" placeholder="密码 (至少8位)" className="w-full p-2 border rounded mb-4" />
                <div className="flex justify-end gap-2">
                    <button onClick={() => setExpandedUser(null)} className="px-4 py-2 bg-gray-200 rounded">取消</button>
                    <button onClick={() => {
                        // 确保从 DOM 获取值
                        const email = document.getElementById('admin-email').value;
                        const password = document.getElementById('admin-password').value;

                        // 调用主函数
                        handleRegisterAdmin(email, password); 
                        setExpandedUser(null);
                    }} className="px-4 py-2 bg-indigo-600 text-white rounded">注册</button>
                </div>
            </div>
        </div>
      )}


      <div className="max-w-7xl mx-auto space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-4 mb-2 text-indigo-600">
              <Users className="w-8 h-8" />
              <h3 className="text-lg font-bold">总用户数</h3>
            </div>
            <p className="text-4xl font-bold text-gray-900">{users.length}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-4 mb-2 text-green-600">
              <FileText className="w-8 h-8" />
              <h3 className="text-lg font-bold">总文档数</h3>
            </div>
            <p className="text-4xl font-bold text-gray-900">{totalDocs}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-4 mb-2 text-purple-600">
              <Users className="w-8 h-8" />
              <h3 className="text-lg font-bold">管理员数</h3>
            </div>
            <p className="text-4xl font-bold text-gray-900">{users.filter(u => u.role === 'admin').length}</p>
          </div>
        </div>

        {/* 用户列表表格 */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-bold text-xl">用户列表</h3>
            <div className="relative w-1/3">
              <Search className="w-4 h-4 absolute left-3 top-3.5 text-gray-400" />
              <input 
                type="text" 
                placeholder="按邮箱搜索用户..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-gray-900 font-bold border-b border-gray-100">
              <tr>
                <th className="p-4">展开</th>
                <th className="p-4">邮箱</th>
                <th className="p-4">角色</th>
                <th className="p-4">文档数量</th>
                <th className="p-4">注册时间</th>
                <th className="p-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center p-6 text-gray-500">加载中...</td></tr>
              ) : (
                users.map(u => (
                  <React.Fragment key={u.id}>
                    <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <button 
                          onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                          className="p-1 text-indigo-600 hover:text-indigo-800"
                        >
                          {expandedUser === u.id ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                        </button>
                      </td>
                      <td className="p-4 font-medium text-gray-900">{u.email}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${u.role==='admin'?'bg-purple-100 text-purple-700':'bg-gray-100 text-gray-600'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-4">{u._count.documents}</td>
                      <td className="p-4">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="p-4">
                        {u.role !== 'admin' ? (
                          <button 
                            onClick={() => handleDeleteUser(u.id)}
                            className="text-red-500 hover:text-red-700 transition-colors p-1"
                            title="删除用户及其所有数据"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">管理员不可删除</span>
                        )}
                      </td>
                    </tr>
                    {expandedUser === u.id && (
                      <tr className="bg-gray-50">
                        <td colSpan="6" className="p-0">
                          <UserDocuments 
                            userId={u.id} 
                            userToken={user.token} 
                            onDocumentDelete={() => setRefreshKey(prev => prev + 1)} 
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}