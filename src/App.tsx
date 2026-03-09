import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Plus, IndianRupee, TrendingUp, TrendingDown, Calendar, Tag, User, Download, Trash2, Database, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { format, isSameMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { db, isFirebaseConfigured, initError } from './firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, limit } from 'firebase/firestore';

type TransactionType = 'Income' | 'Expense';

interface Transaction {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  type: TransactionType;
  user: string;
}

const EXPENSE_CATEGORIES = ['Groceries', 'Rent/Mortgage', 'Utilities', 'Transportation', 'Entertainment', 'Dining Out', 'Healthcare', 'Other'];
const INCOME_CATEGORIES = ['Salary', 'Business', 'Investments', 'Gifts', 'Other'];

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [type, setType] = useState<TransactionType>('Expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const currentUser = 'samadca@gmail.com'; // Mock active user

  const categories = type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  useEffect(() => {
    if (isFirebaseConfigured) {
      fetchTransactions();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchTransactions = async () => {
    try {
      const q = query(collection(db!, 'transactions'), orderBy('date', 'desc'), limit(100));
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    setCategory(newType === 'Expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
  };

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;

    const selectedDate = date ? new Date(date + 'T12:00:00') : new Date();

    const newTransaction = {
      date: selectedDate.toISOString(),
      category,
      description: description || '',
      amount: Number(amount),
      type,
      user: currentUser,
    };

    try {
      const docRef = await addDoc(collection(db!, 'transactions'), newTransaction);
      setTransactions([{ id: docRef.id, ...newTransaction } as Transaction, ...transactions]);
      setAmount('');
      setDescription('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      showNotification('Transaction added successfully!', 'success');
    } catch (error) {
      console.error('Error saving transaction:', error);
      showNotification('Failed to add transaction.', 'error');
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(doc(db!, 'transactions', deleteConfirmId));
      setTransactions(transactions.filter(t => t.id !== deleteConfirmId));
      showNotification('Transaction deleted.', 'success');
    } catch (error) {
      console.error('Error deleting transaction:', error);
      showNotification('Failed to delete transaction.', 'error');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmId(null);
  };

  const downloadReport = async () => {
    const now = new Date();
    const currentMonthTransactions = transactions.filter(t => isSameMonth(new Date(t.date), now));
    
    if (currentMonthTransactions.length === 0) {
      alert("No transactions to download for this month.");
      return;
    }

    const pdf = new jsPDF();
    pdf.setFontSize(18);
    pdf.text(`Monthly Expense Report - ${format(now, 'MMMM yyyy')}`, 14, 20);

    let startY = 30;
    const chartElement = document.getElementById('chart-container');
    
    if (chartElement) {
      try {
        const canvas = await html2canvas(chartElement, { scale: 2, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 180;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(imgData, 'PNG', 14, 30, imgWidth, imgHeight);
        startY = 30 + imgHeight + 10;
      } catch (err) {
        console.error("Failed to capture chart", err);
      }
    }

    autoTable(pdf, {
      startY: startY,
      head: [['Date', 'Description', 'Category', 'Type', 'Amount (Rs)']],
      body: currentMonthTransactions.map(t => [
        format(new Date(t.date), 'MMM d, yyyy'),
        t.description || '-',
        t.category,
        t.type,
        t.amount.toFixed(2)
      ]),
    });

    pdf.save(`expense_report_${format(now, 'yyyy_MM')}.pdf`);
  };

  const stats = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let monthlyIncome = 0;
    let monthlyExpense = 0;
    const now = new Date();

    transactions.forEach((t) => {
      const tDate = new Date(t.date);
      if (t.type === 'Income') {
        totalIncome += t.amount;
        if (isSameMonth(tDate, now)) monthlyIncome += t.amount;
      } else {
        totalExpense += t.amount;
        if (isSameMonth(tDate, now)) monthlyExpense += t.amount;
      }
    });

    return {
      balance: totalIncome - totalExpense,
      monthlyIncome,
      monthlyExpense,
    };
  }, [transactions]);

  const chartData = [
    { name: 'Income', value: stats.monthlyIncome, color: '#10b981' },
    { name: 'Expenses', value: stats.monthlyExpense, color: '#ef4444' },
  ].filter(d => d.value > 0);

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Loading...</div>;
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-100 max-w-2xl w-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
              <AlertCircle size={24} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Database Connection Error</h1>
          </div>
          <div className="prose prose-slate max-w-none text-rose-600">
            <p>Firebase failed to initialize. This usually happens if your environment variables are incorrect or missing the <strong>appId</strong>.</p>
            <p className="font-mono text-sm bg-rose-50 p-4 rounded-lg mt-4">{initError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 max-w-2xl w-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Database size={24} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Online Database Setup Required</h1>
          </div>
          <div className="prose prose-slate max-w-none">
            <p>To make your data accessible across all your devices, we've upgraded the app to use <strong>Firebase Firestore</strong> (a free online database).</p>
            <h3 className="text-lg font-semibold mt-6 mb-2">Please follow these steps:</h3>
            <ol className="list-decimal pl-5 space-y-2">
              <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Firebase Console</a> and create a new project.</li>
              <li>Add a <strong>Web App</strong> to your project (click the <code>&lt;/&gt;</code> icon).</li>
              <li>Go to <strong>Firestore Database</strong> in the left menu and click <strong>Create database</strong> (Start in <strong>Test Mode</strong>).</li>
              <li>Copy your Firebase config and add these environment variables in AI Studio (using the Secrets panel):
                <ul className="list-disc pl-5 mt-2 space-y-1 font-mono text-sm bg-slate-50 p-4 rounded-lg border border-slate-100">
                  <li>VITE_FIREBASE_API_KEY</li>
                  <li>VITE_FIREBASE_AUTH_DOMAIN</li>
                  <li>VITE_FIREBASE_PROJECT_ID</li>
                  <li>VITE_FIREBASE_APP_ID <span className="text-slate-400 font-sans">(Optional but recommended)</span></li>
                </ul>
              </li>
            </ol>
            <p className="mt-6 text-sm text-slate-500">Once configured, the app will automatically connect and you can start tracking expenses from any device!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Unzila's Expense Tracker</h1>
            <p className="text-slate-500 mt-1 flex items-center gap-2">
              <User size={16} /> Logged in as <span className="font-medium text-slate-700">{currentUser}</span>
            </p>
          </div>
          <button
            onClick={downloadReport}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm font-medium text-sm"
          >
            <Download size={16} />
            Download Monthly Report (PDF)
          </button>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <IndianRupee size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Balance</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">₹{stats.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Monthly Income</p>
              <p className="text-3xl font-bold text-emerald-600 mt-1">₹{stats.monthlyIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
              <TrendingDown size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Monthly Expenses</p>
              <p className="text-3xl font-bold text-rose-600 mt-1">₹{stats.monthlyExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Add Transaction Form */}
          <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <Plus size={20} className="text-blue-600" /> Add Transaction
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleTypeChange('Expense')}
                    className={`py-2 text-sm font-medium rounded-md transition-colors ${type === 'Expense' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeChange('Income')}
                    className={`py-2 text-sm font-medium rounded-md transition-colors ${type === 'Income' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Income
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Calendar size={16} className="text-slate-400" />
                  </div>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <IndianRupee size={16} className="text-slate-400" />
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Tag size={16} className="text-slate-400" />
                  </div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none bg-white transition-all"
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description <span className="text-slate-400 font-normal">(Optional)</span></label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="e.g., Groceries at Whole Foods"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Save Transaction
              </button>
            </form>
          </div>

          {/* Chart & List */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Chart */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <h2 className="text-xl font-semibold mb-6">Monthly Overview</h2>
              <div id="chart-container" className="h-64 w-full bg-white">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: number) => `₹${value.toFixed(2)}`}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400">
                    No data for this month
                  </div>
                )}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Recent Transactions</h2>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-medium">Date</th>
                      <th className="px-6 py-4 font-medium">Description</th>
                      <th className="px-6 py-4 font-medium">Category</th>
                      <th className="px-6 py-4 font-medium">User</th>
                      <th className="px-6 py-4 font-medium text-right">Amount</th>
                      <th className="px-6 py-4 font-medium text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                          No transactions yet. Add one above!
                        </td>
                      </tr>
                    ) : (
                      transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-slate-500 flex items-center gap-2">
                            <Calendar size={14} /> {format(new Date(t.date), 'MMM d, yyyy')}
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-900">{t.description || '-'}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                              {t.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500 text-xs">{t.user}</td>
                          <td className={`px-6 py-4 whitespace-nowrap text-right font-semibold ${t.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {t.type === 'Income' ? '+' : '-'}₹{t.amount.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => handleDeleteClick(t.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Transaction"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed bottom-4 right-4 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all duration-300 animate-in slide-in-from-bottom-5 ${notification.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          {notification.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {notification.message}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="p-2 bg-rose-50 rounded-full">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Delete Transaction?</h3>
            </div>
            <p className="text-slate-500 text-sm mb-6">This action cannot be undone. The transaction will be permanently removed from your database.</p>
            <div className="flex gap-3">
              <button
                onClick={cancelDelete}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-xl transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
