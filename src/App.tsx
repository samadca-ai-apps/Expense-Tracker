import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Plus, IndianRupee, TrendingUp, TrendingDown, Calendar, Tag, User, Download, Trash2, Database, CheckCircle, XCircle, AlertCircle, Camera, Loader2, Edit2, LayoutDashboard, List, PlusCircle, X, FileText, LogOut, LogIn } from 'lucide-react';
import { format, isSameMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { db, auth, googleProvider, isFirebaseConfigured, initError } from './firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, limit, updateDoc, where } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { GoogleGenAI, Type } from '@google/genai';

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

const EXPENSE_CATEGORIES = ['Groceries', 'Rent/Mortgage', 'Utilities', 'Transportation', 'Entertainment', 'Dining Out', 'Healthcare', 'Charity', 'Education', 'Savings', 'Gifts', 'Other'];
const INCOME_CATEGORIES = ['Salary', 'Business', 'Investments', 'Gifts', 'Other'];

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [type, setType] = useState<TransactionType>('Expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'add' | 'transactions'>('dashboard');
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState<'monthly' | 'yearly'>('monthly');
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [reportYear, setReportYear] = useState(format(new Date(), 'yyyy'));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const billUploadRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const categories = type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        fetchTransactions(currentUser.email!);
      } else {
        setTransactions([]);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const fetchTransactions = async (email: string) => {
    setLoading(true);
    try {
      const q = query(
        collection(db!, 'transactions'),
        where('user', '==', email),
        orderBy('date', 'desc'),
        limit(100)
      );
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!auth || !googleProvider) return;
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login Error:", error);
      showNotification('Failed to log in.', 'error');
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!process.env.GEMINI_API_KEY) {
      showNotification('Gemini API Key is missing.', 'error');
      return;
    }

    setIsAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data
                }
              },
              {
                text: `Analyze this receipt or bill. Extract the total amount, a short description (e.g. vendor name), the date (YYYY-MM-DD), and the best matching category from this list: ${EXPENSE_CATEGORIES.join(', ')}.`
              }
            ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                amount: { type: Type.NUMBER, description: "Total amount on the receipt" },
                description: { type: Type.STRING, description: "Vendor name or short description" },
                date: { type: Type.STRING, description: "Date in YYYY-MM-DD format" },
                category: { type: Type.STRING, description: "Best matching category from the provided list" }
              },
              required: ["amount", "description", "date", "category"]
            }
          }
        });

        if (response.text) {
          const data = JSON.parse(response.text);
          if (data.amount) setAmount(data.amount.toString());
          if (data.description) setDescription(data.description);
          if (data.date) setDate(data.date);
          if (data.category && EXPENSE_CATEGORIES.includes(data.category)) {
            setCategory(data.category);
          } else {
            setCategory('Other');
          }
          setType('Expense');
          showNotification('Receipt analyzed successfully! Please review the details.', 'success');
        }
        setIsAnalyzing(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error analyzing receipt:", error);
      showNotification('Failed to analyze receipt.', 'error');
      setIsAnalyzing(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;

    const selectedDate = date ? new Date(date + 'T12:00:00') : new Date();

    const transactionData = {
      date: selectedDate.toISOString(),
      category,
      description: description || '',
      amount: Number(amount),
      type,
      user: user?.email || '',
    };

    try {
      if (editingId) {
        await updateDoc(doc(db!, 'transactions', editingId), transactionData);
        setTransactions(transactions.map(t => t.id === editingId ? { id: editingId, ...transactionData } as Transaction : t));
        showNotification('Transaction updated successfully!', 'success');
        cancelEdit();
      } else {
        const docRef = await addDoc(collection(db!, 'transactions'), transactionData);
        setTransactions([{ id: docRef.id, ...transactionData } as Transaction, ...transactions]);
        setAmount('');
        setDescription('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        showNotification('Transaction added successfully!', 'success');
      }
    } catch (error) {
      console.error('Error saving transaction:', error);
      showNotification('Failed to save transaction.', 'error');
    }
  };

  const handleEditClick = (t: Transaction) => {
    setEditingId(t.id);
    setAmount(t.amount.toString());
    setCategory(t.category);
    setDescription(t.description);
    setDate(format(new Date(t.date), 'yyyy-MM-dd'));
    setType(t.type);
    setActiveTab('add');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setAmount('');
    setDescription('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setActiveTab('transactions');
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

  const generateReport = async () => {
    const docPdf = new jsPDF();
    const title = reportType === 'monthly'
      ? `Expense Report - ${format(new Date(reportMonth + '-01T12:00:00'), 'MMMM yyyy')}`
      : `Expense Report - Year ${reportYear}`;

    const filtered = transactions.filter(t => {
      const tDate = new Date(t.date);
      if (reportType === 'monthly') {
        return format(tDate, 'yyyy-MM') === reportMonth;
      } else {
        return format(tDate, 'yyyy') === reportYear;
      }
    });

    if (filtered.length === 0) {
      alert("No transactions to download for this period.");
      return;
    }

    docPdf.setFontSize(20);
    docPdf.text(title, 14, 22);

    const totalIncome = filtered.filter(t => t.type === 'Income').reduce((acc, curr) => acc + curr.amount, 0);
    const totalExpense = filtered.filter(t => t.type === 'Expense').reduce((acc, curr) => acc + curr.amount, 0);
    const balance = totalIncome - totalExpense;

    docPdf.setFontSize(12);
    docPdf.text(`Total Income: Rs. ${totalIncome.toFixed(2)}`, 14, 32);
    docPdf.text(`Total Expense: Rs. ${totalExpense.toFixed(2)}`, 14, 38);
    docPdf.text(`Net Balance: Rs. ${balance.toFixed(2)}`, 14, 44);

    docPdf.setFontSize(14);
    docPdf.text('Date-wise Transactions', 14, 56);

    const tableData = filtered.map(t => [
      format(new Date(t.date), 'MMM d, yyyy'),
      t.type,
      t.category,
      t.description || '-',
      `Rs. ${t.amount.toFixed(2)}`
    ]);

    autoTable(docPdf, {
      startY: 60,
      head: [['Date', 'Type', 'Category', 'Description', 'Amount']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [63, 131, 248] },
    });

    const categoryTotals = filtered.reduce((acc, t) => {
      if (!acc[t.category]) acc[t.category] = { Income: 0, Expense: 0 };
      acc[t.category][t.type as 'Income' | 'Expense'] += t.amount;
      return acc;
    }, {} as Record<string, { Income: number, Expense: number }>);

    const catTableData = Object.entries(categoryTotals).map(([cat, totals]: [string, { Income: number, Expense: number }]) => [
      cat,
      `Rs. ${totals.Income.toFixed(2)}`,
      `Rs. ${totals.Expense.toFixed(2)}`,
      `Rs. ${totals.Income > totals.Expense ? '+' : ''}Rs. ${(totals.Income - totals.Expense).toFixed(2)}`
    ]);

    const finalY = (docPdf as any).lastAutoTable.finalY || 60;

    docPdf.text('Category-wise Summary', 14, finalY + 14);

    autoTable(docPdf, {
      startY: finalY + 18,
      head: [['Category', 'Total Income', 'Total Expense', 'Net']],
      body: catTableData,
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129] },
    });

    docPdf.save(`${title.replace(/ /g, '_')}.pdf`);
    setShowReportModal(false);
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

  if (loading || authLoading) {
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

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <IndianRupee size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Unzila's Expense Tracker</h1>
          <p className="text-slate-500 mb-8">Sign in to manage your personal expenses and income securely.</p>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>
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
              <User size={16} /> Logged in as <span className="font-medium text-slate-700">{user.email}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowReportModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm font-medium text-sm"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Download Report</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-xl hover:bg-rose-50 transition-colors shadow-sm font-medium text-sm"
              title="Sign Out"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
          <div className="col-span-2 md:col-span-1 bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-slate-100 flex items-center gap-3 md:gap-4">
            <div className="p-2 md:p-3 bg-blue-50 text-blue-600 rounded-xl">
              <IndianRupee size={20} className="md:w-6 md:h-6" />
            </div>
            <div>
              <p className="text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider">Total Balance</p>
              <p className="text-xl md:text-3xl font-bold text-slate-900 mt-1">₹{stats.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-slate-100 flex items-center gap-3 md:gap-4">
            <div className="p-2 md:p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <TrendingUp size={20} className="md:w-6 md:h-6" />
            </div>
            <div>
              <p className="text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider">Income</p>
              <p className="text-lg md:text-3xl font-bold text-emerald-600 mt-1">₹{stats.monthlyIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-slate-100 flex items-center gap-3 md:gap-4">
            <div className="p-2 md:p-3 bg-rose-50 text-rose-600 rounded-xl">
              <TrendingDown size={20} className="md:w-6 md:h-6" />
            </div>
            <div>
              <p className="text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider">Expenses</p>
              <p className="text-lg md:text-3xl font-bold text-rose-600 mt-1">₹{stats.monthlyExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-24 lg:pb-0">
          
          {/* Add Transaction Form */}
          <div className={`lg:col-span-1 ${activeTab === 'add' ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sticky top-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Plus size={20} className="text-blue-600" /> {editingId ? 'Edit Transaction' : 'Add Transaction'}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => billUploadRef.current?.click()}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    title="Upload Bill"
                  >
                    {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
                    <span className="hidden sm:inline">{isAnalyzing ? 'Analyzing...' : 'Upload Bill'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    title="Scan Receipt"
                  >
                    {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    <span className="hidden sm:inline">{isAnalyzing ? 'Analyzing...' : 'Scan'}</span>
                  </button>
                </div>
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
              />
              <input 
                type="file" 
                accept="image/*" 
                ref={billUploadRef} 
                onChange={handleFileUpload} 
                className="hidden" 
              />
            </div>
            
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

              <div className="flex gap-3 pt-2">
                {editingId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || isAnalyzing}
                  className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {editingId ? 'Update' : 'Save'} Transaction
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Chart & List */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Dashboard Tab Content */}
          <div className={`space-y-8 ${activeTab === 'dashboard' ? 'block' : 'hidden lg:block'}`}>
            
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
          </div>

          {/* Transactions Tab Content */}
          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${activeTab === 'transactions' ? 'block' : 'hidden lg:block'}`}>
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Recent Transactions</h2>
            </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-3 md:px-6 py-4 font-medium">Date</th>
                      <th className="px-3 md:px-6 py-4 font-medium hidden md:table-cell">Description</th>
                      <th className="px-3 md:px-6 py-4 font-medium">Category</th>
                      <th className="px-3 md:px-6 py-4 font-medium hidden md:table-cell">User</th>
                      <th className="px-3 md:px-6 py-4 font-medium text-right">Amount</th>
                      <th className="px-3 md:px-6 py-4 font-medium text-center">Action</th>
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
                          <td className="px-3 md:px-6 py-4 whitespace-nowrap text-slate-500">
                            <div className="flex items-center gap-2">
                              {/* Mobile Circle Date */}
                              <div className="md:hidden flex flex-col items-center justify-center w-10 h-10 rounded-full bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                                <span className="text-[9px] uppercase font-bold leading-none">{format(new Date(t.date), 'MMM')}</span>
                                <span className="text-sm font-bold leading-tight">{format(new Date(t.date), 'd')}</span>
                              </div>
                              {/* Desktop Date */}
                              <span className="hidden md:flex items-center gap-2">
                                <Calendar size={14} /> {format(new Date(t.date), 'MMM d, yyyy')}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 md:px-6 py-4 font-medium text-slate-900 hidden md:table-cell">{t.description || '-'}</td>
                          <td className="px-3 md:px-6 py-4">
                            <span className="inline-flex items-center px-2 md:px-2.5 py-0.5 rounded-full text-[10px] md:text-xs font-medium bg-slate-100 text-slate-700">
                              {t.category}
                            </span>
                          </td>
                          <td className="px-3 md:px-6 py-4 text-slate-500 text-xs hidden md:table-cell">{t.user}</td>
                          <td className={`px-3 md:px-6 py-4 whitespace-nowrap text-right font-semibold text-xs md:text-sm ${t.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {t.type === 'Income' ? '+' : '-'}₹{t.amount.toFixed(2)}
                          </td>
                          <td className="px-3 md:px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setSelectedTransaction(t)}
                                className="md:hidden p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-xs font-medium"
                              >
                                Details
                              </button>
                              <button
                                onClick={() => handleEditClick(t)}
                                className="hidden md:block p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit Transaction"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteClick(t.id)}
                                className="hidden md:block p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Delete Transaction"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
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
        <div className={`fixed bottom-24 lg:bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all duration-300 animate-in slide-in-from-bottom-5 ${notification.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
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
      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <FileText size={20} className="text-blue-600" /> Generate Report
              </h3>
              <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Report Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={reportType === 'monthly'} onChange={() => setReportType('monthly')} className="text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-slate-700">Monthly</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={reportType === 'yearly'} onChange={() => setReportType('yearly')} className="text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-slate-700">Yearly</span>
                  </label>
                </div>
              </div>

              {reportType === 'monthly' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Select Month</label>
                  <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="block w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Select Year</label>
                  <input type="number" min="2000" max="2100" value={reportYear} onChange={(e) => setReportYear(e.target.value)} className="block w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowReportModal(false)} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={generateReport} className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                <Download size={18} /> Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 pb-4 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1 p-2 w-20 rounded-xl transition-colors ${activeTab === 'dashboard' ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}>
          <LayoutDashboard size={20} />
          <span className="text-[10px] font-medium">Dashboard</span>
        </button>
        <button onClick={() => setActiveTab('add')} className={`flex flex-col items-center gap-1 p-2 w-20 rounded-xl transition-colors ${activeTab === 'add' ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}>
          <PlusCircle size={20} />
          <span className="text-[10px] font-medium">Add</span>
        </button>
        <button onClick={() => setActiveTab('transactions')} className={`flex flex-col items-center gap-1 p-2 w-20 rounded-xl transition-colors ${activeTab === 'transactions' ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}>
          <List size={20} />
          <span className="text-[10px] font-medium">List</span>
        </button>
      </div>
      {/* Transaction Details Modal */}
      {selectedTransaction && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-900">Transaction Details</h3>
              <button onClick={() => setSelectedTransaction(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500 text-sm">Date</span>
                <span className="text-slate-900 font-medium">{format(new Date(selectedTransaction.date), 'MMMM d, yyyy')}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500 text-sm">Type</span>
                <span className={`font-medium ${selectedTransaction.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {selectedTransaction.type}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500 text-sm">Category</span>
                <span className="text-slate-900 font-medium">{selectedTransaction.category}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500 text-sm">Amount</span>
                <span className={`font-bold ${selectedTransaction.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  ₹{selectedTransaction.amount.toFixed(2)}
                </span>
              </div>
              <div className="py-2">
                <span className="text-slate-500 text-sm block mb-1">Description</span>
                <p className="text-slate-900 bg-slate-50 p-3 rounded-lg text-sm italic">
                  {selectedTransaction.description || 'No description provided'}
                </p>
              </div>
              <div className="py-2">
                <span className="text-slate-500 text-sm block mb-1">User</span>
                <span className="text-slate-700 text-xs break-all">{selectedTransaction.user}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-8">
              <button
                onClick={() => {
                  handleEditClick(selectedTransaction);
                  setSelectedTransaction(null);
                }}
                className="flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-600 font-medium rounded-xl hover:bg-blue-100 transition-colors"
              >
                <Edit2 size={16} /> Edit
              </button>
              <button
                onClick={() => {
                  handleDeleteClick(selectedTransaction.id);
                  setSelectedTransaction(null);
                }}
                className="flex items-center justify-center gap-2 py-2.5 bg-rose-50 text-rose-600 font-medium rounded-xl hover:bg-rose-100 transition-colors"
              >
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
