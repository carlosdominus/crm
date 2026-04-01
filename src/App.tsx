import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { 
  Settings,
  Save,
  Database,
  RefreshCw, 
  Search, 
  ExternalLink, 
  Copy, 
  CheckCircle2,
  Clock,
  Trash2,
  ChevronRight,
  X,
  History,
  Package,
  Calendar,
  Filter,
  ChevronDown,
  Phone,
  Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parse, getTime, startOfDay, endOfDay, startOfWeek, startOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Lead, Client, STATUS_THEMES } from './types';
import { cn } from './lib/utils';
import { generatePersonalizedMessage } from './services/gemini';

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1_rVWRk6_Knv5WLRONjC-wh_vFH6SymnTTFxbwqn-ehY/export?format=csv";

export default function App() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem('crm_webhook_url') || "");
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  
  // Tagging state
  const [clientTags, setClientTags] = useState<Record<string, 'pendente' | 'feito' | 'lixo' | null>>(() => {
    const saved = localStorage.getItem('crm_client_tags');
    // Migration: old tags to new tags
    if (saved) {
      const parsed = JSON.parse(saved);
      const migrated: Record<string, any> = {};
      Object.entries(parsed).forEach(([key, val]) => {
        if (val === 'entrar em contato') migrated[key] = 'pendente';
        else if (val === 'contato enviado') migrated[key] = 'feito';
        else migrated[key] = val;
      });
      return migrated;
    }
    return {};
  });

  useEffect(() => {
    localStorage.setItem('crm_client_tags', JSON.stringify(clientTags));
  }, [clientTags]);

  const toggleTag = async (clientKey: string, tag: 'pendente' | 'feito' | 'lixo') => {
    const newTag = clientTags[clientKey] === tag ? null : tag;
    setClientTags(prev => ({
      ...prev,
      [clientKey]: newTag
    }));

    // Sync to Google Sheets if webhook is configured
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientKey,
            tag: newTag || '',
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error("Erro ao sincronizar com a planilha:", error);
      }
    }
  };

  const handleGenerateMessage = async (lead: Lead) => {
    setSelectedLead(lead);
    setGenerating(true);
    setGeneratedMessage(null);
    const msg = await generatePersonalizedMessage(lead);
    setGeneratedMessage(msg);
    setGenerating(false);
  };

  const fetchData = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(SHEET_CSV_URL);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase(),
        complete: (results) => {
          const rawLeads: Lead[] = results.data.map((row: any) => {
            const dateStr = row['data'] || '';
            const timeStr = row['hora'] || '';
            let timestamp = 0;
            try {
              if (dateStr && timeStr) {
                // Try parsing with seconds first, then without
                let parsedDate = parse(`${dateStr} ${timeStr}`, 'dd/MM/yyyy HH:mm:ss', new Date());
                if (isNaN(getTime(parsedDate))) {
                  parsedDate = parse(`${dateStr} ${timeStr}`, 'dd/MM/yyyy HH:mm', new Date());
                }
                timestamp = isNaN(getTime(parsedDate)) ? 0 : getTime(parsedDate);
              }
            } catch (e) {
              timestamp = 0;
            }

            const rawValor = row['valor'] || row['vlr'] || '0';
            let cleanValor = rawValor.toString().replace(/[R$\s]/g, '');
            
            if (cleanValor.includes(',') && cleanValor.includes('.')) {
              if (cleanValor.indexOf('.') < cleanValor.indexOf(',')) {
                cleanValor = cleanValor.replace(/\./g, '').replace(',', '.');
              } else {
                cleanValor = cleanValor.replace(/,/g, '');
              }
            } else if (cleanValor.includes(',')) {
              cleanValor = cleanValor.replace(',', '.');
            }
            
            const leadValue = parseFloat(cleanValor);
            const rawStatus = (row['status'] || 'Pendente').trim().toLowerCase();
            let normalizedStatus = 'Pendente';
            
            // Robust column detection for phone/email if swapped or headers are weird
            let telefoneRaw = (row['telefone'] || row['whatsapp'] || row['celular'] || row['phone'] || '').toString().trim();
            let emailRaw = (row['email'] || row['e-mail'] || row['mail'] || '').toString().trim();

            // If headers are swapped or data is in the wrong place (C to B, B to C)
            // Check if emailRaw looks like a phone and telefoneRaw looks like an email
            const isEmail = (val: string) => val.includes('@');
            const isPhone = (val: string) => /[\d\s()-]{8,}/.test(val) && !val.includes('@');

            if (isEmail(telefoneRaw) && !isEmail(emailRaw)) {
              // Swap them back
              const temp = telefoneRaw;
              telefoneRaw = emailRaw;
              emailRaw = temp;
            } else if (!isEmail(emailRaw) && isEmail(telefoneRaw)) {
              emailRaw = telefoneRaw;
              telefoneRaw = '';
            }

            if (rawStatus.startsWith('approved') || rawStatus === 'aprovado' || rawStatus === 'pago' || rawStatus === 'concluido') {
              normalizedStatus = 'Aprovado';
            } else if (rawStatus.startsWith('pending') || rawStatus === 'pendente' || rawStatus === 'aguardando') {
              normalizedStatus = 'Pendente';
            } else if (rawStatus.startsWith('rejected') || rawStatus === 'cancelado') {
              normalizedStatus = 'Cancelado';
            } else if (rawStatus === 'reembolsado') {
              normalizedStatus = 'Reembolsado';
            } else if (rawStatus === '12') {
              normalizedStatus = 'Carrinho Abandonado';
            }

            return {
              id: row['id'] || Math.random().toString(36).substr(2, 9),
              nome: (row['nome'] || 'Sem Nome').trim(),
              telefone: telefoneRaw,
              email: emailRaw,
              produto: (row['produto'] || '').trim(),
              valor: isNaN(leadValue) ? 'R$ 0,00' : `R$ ${leadValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
              status: normalizedStatus,
              codPay: (row['cod pay'] || '').trim(),
              data: dateStr,
              hora: timeStr,
              timestamp,
              numericValue: isNaN(leadValue) ? 0 : leadValue
            };
          });

          const clientMap = new Map<string, Client>();
          
          rawLeads.forEach(lead => {
            const key = (lead.email || lead.telefone || lead.nome).toLowerCase().trim();
            if (!key) return;

            const existing = clientMap.get(key);
            const leadValue = lead.numericValue;
            const isAprovado = lead.status === 'Aprovado';

            if (existing) {
              existing.leads.push(lead);
              if (isAprovado) {
                existing.totalSpent += leadValue;
                existing.status = 'Aprovado';
              }
              
              if (lead.timestamp > existing.lastPurchaseTimestamp) {
                existing.lastPurchaseDate = lead.data;
                existing.lastPurchaseTimestamp = lead.timestamp;
                // Only update status from a newer lead if we haven't found an 'Aprovado' one yet
                if (existing.status !== 'Aprovado') {
                  existing.status = lead.status;
                }
              }
            } else {
              clientMap.set(key, {
                email: lead.email,
                nome: lead.nome,
                telefone: lead.telefone,
                leads: [lead],
                totalSpent: isAprovado ? leadValue : 0,
                lastPurchaseDate: lead.data,
                lastPurchaseTimestamp: lead.timestamp,
                status: lead.status
              });
            }
          });

          const sortedClients = Array.from(clientMap.values()).map(client => ({
            ...client,
            leads: [...client.leads].sort((a, b) => {
              if (b.timestamp !== a.timestamp) {
                return b.timestamp - a.timestamp;
              }
              // If timestamps are equal, prioritize 'Aprovado'
              if (b.status === 'Aprovado' && a.status !== 'Aprovado') return 1;
              if (a.status === 'Aprovado' && b.status !== 'Aprovado') return -1;
              return 0;
            })
          })).sort((a, b) => b.lastPurchaseTimestamp - a.lastPurchaseTimestamp);

          // Auto-tag clients without phone as 'lixo'
          const newTags = { ...clientTags };
          let changed = false;
          sortedClients.forEach(client => {
            const key = (client.email || client.telefone || client.nome).toLowerCase().trim();
            if (!client.telefone && !newTags[key]) {
              newTags[key] = 'lixo';
              changed = true;
            }
          });
          if (changed) setClientTags(newTags);

          setClients(sortedClients);
          setLoading(false);
          setRefreshing(false);
        },
        error: (error: any) => {
          console.error("Erro ao processar CSV:", error);
          setLoading(false);
          setRefreshing(false);
        }
      });
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredClients = useMemo(() => {
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = now;

    if (filterType === 'today') {
      start = startOfDay(now);
      end = endOfDay(now);
    } else if (filterType === 'week') {
      start = startOfWeek(now, { weekStartsOn: 0 }); // Sunday
    } else if (filterType === 'month') {
      start = startOfMonth(now);
    } else if (filterType === 'custom' && customStartDate && customEndDate) {
      start = startOfDay(parse(customStartDate, 'yyyy-MM-dd', new Date()));
      end = endOfDay(parse(customEndDate, 'yyyy-MM-dd', new Date()));
    }

    return clients.filter(client => {
      const clientKey = client.email || client.telefone || client.nome;
      const tag = clientTags[clientKey] || 'enviar msg';

      const matchesSearch = 
        client.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.telefone.includes(searchTerm);
      
      const matchesStatus = statusFilter === 'all' || client.status === statusFilter;
      const matchesTag = tagFilter === 'all' || tag === tagFilter;

      let matchesDate = true;
      if (filterType !== 'all') {
        if (filterType === 'custom' && (!customStartDate || !customEndDate)) {
          matchesDate = true;
        } else {
          matchesDate = client.leads.some(l => {
            const leadDate = new Date(l.timestamp);
            return isWithinInterval(leadDate, { start: start!, end: end! });
          });
        }
      }
      
      return matchesSearch && matchesStatus && matchesTag && matchesDate;
    });
  }, [clients, searchTerm, filterType, customStartDate, customEndDate, statusFilter, tagFilter, clientTags]);

  const stats = useMemo(() => {
    const totalClients = clients.length;
    const activeClients = clients.filter(c => c.leads.some(l => l.status === 'Aprovado')).length;
    const totalRevenue = clients.reduce((acc, curr) => acc + curr.totalSpent, 0);

    return { totalClients, activeClients, totalRevenue };
  }, [clients]);

  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(clients.map(c => c.status));
    return Array.from(statuses).sort();
  }, [clients]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-modern-bg font-sans">
      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header - Simple Style */}
        <header className="h-20 px-10 glass-header flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-6">
            <div className="w-10 h-10 bg-modern-primary rounded-none flex items-center justify-center text-white shadow-lg shadow-modern-primary/20">
              <Package size={20} />
            </div>
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold tracking-tight text-modern-text">CRM Planilha</h1>
              <div className="h-4 w-px bg-modern-border" />
              <p className="text-xs font-semibold text-modern-secondary">Controle de Leads</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:flex gap-6">
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Total Receita</p>
                <p className="text-sm font-bold text-modern-text">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalRevenue)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Total Clientes</p>
                <p className="text-sm font-bold text-modern-text">{stats.totalClients}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowSettings(true)}
                className="w-10 h-10 bg-white border border-modern-border rounded-none flex items-center justify-center text-modern-secondary hover:text-modern-primary transition-all shadow-sm"
                title="Configurações de Sincronização"
              >
                <Settings size={18} />
              </button>
              <button 
                onClick={fetchData}
                disabled={refreshing}
                className="w-10 h-10 bg-white border border-modern-border rounded-none flex items-center justify-center text-modern-secondary hover:text-modern-primary transition-all disabled:opacity-30 shadow-sm"
              >
                <RefreshCw size={18} strokeWidth={2.5} className={cn(refreshing && "animate-spin")} />
              </button>
            </div>
          </div>
        </header>

        {/* Search Bar & Filters */}
        <div className="px-10 py-6 flex flex-wrap items-center gap-6 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-modern-secondary" size={18} />
            <input 
              type="text" 
              placeholder="Pesquisar clientes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-4 focus:ring-modern-primary/5 transition-all placeholder:text-modern-secondary/40 shadow-sm"
            />
          </div>

            <div className="relative">
              <button 
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="flex items-center gap-3 bg-white border border-modern-border rounded-none px-5 py-3 shadow-sm hover:bg-slate-50 transition-colors text-sm font-bold text-modern-text"
              >
                <Filter size={18} className="text-modern-secondary" />
                <span>Filtros</span>
                <ChevronDown size={16} className={cn("text-modern-secondary transition-transform", showFilterMenu && "rotate-180")} />
              </button>

              <AnimatePresence>
                {showFilterMenu && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setShowFilterMenu(false)}
                      className="fixed inset-0 z-10"
                    />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-3 w-80 bg-white border border-modern-border rounded-none shadow-2xl z-20 overflow-hidden p-4 space-y-6"
                    >
                      {/* Período */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary px-1">Período</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'all', label: 'Todos' },
                            { id: 'today', label: 'Hoje' },
                            { id: 'week', label: 'Semana' },
                            { id: 'month', label: 'Mês' },
                            { id: 'custom', label: 'Personalizado' }
                          ].map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setFilterType(item.id as any)}
                              className={cn(
                                "text-left px-3 py-2 rounded-none text-[11px] font-bold transition-colors border",
                                filterType === item.id 
                                  ? "bg-modern-primary/10 border-modern-primary/20 text-modern-primary" 
                                  : "bg-white border-modern-border text-modern-text hover:bg-slate-50"
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                        {filterType === 'custom' && (
                          <div className="mt-2 p-3 bg-slate-50 border border-modern-border space-y-3">
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold uppercase text-modern-secondary">Início</p>
                              <input 
                                type="date" 
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="w-full bg-white border border-modern-border rounded-none px-2 py-1.5 text-[11px] font-bold text-modern-text focus:outline-none"
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold uppercase text-modern-secondary">Fim</p>
                              <input 
                                type="date" 
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="w-full bg-white border border-modern-border rounded-none px-2 py-1.5 text-[11px] font-bold text-modern-text focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Status */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary px-1">Status da Planilha</p>
                        <select 
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                          className="w-full bg-white border border-modern-border rounded-none px-3 py-2 text-[11px] font-bold text-modern-text focus:outline-none"
                        >
                          <option value="all">Todos os Status</option>
                          {uniqueStatuses.map(status => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>

                      {/* Tags/Ações */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary px-1">Ações / Tags</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'all', label: 'Todas' },
                            { id: 'enviar msg', label: 'Enviar Msg' },
                            { id: 'pendente', label: 'Pendente' },
                            { id: 'feito', label: 'Feito' },
                            { id: 'lixo', label: 'Lixo' }
                          ].map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setTagFilter(item.id)}
                              className={cn(
                                "text-left px-3 py-2 rounded-none text-[11px] font-bold transition-colors border",
                                tagFilter === item.id 
                                  ? "bg-modern-primary/10 border-modern-primary/20 text-modern-primary" 
                                  : "bg-white border-modern-border text-modern-text hover:bg-slate-50"
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button 
                        onClick={() => setShowFilterMenu(false)}
                        className="w-full bg-modern-text text-white py-2.5 font-bold text-[11px] hover:bg-modern-text/90 transition-all"
                      >
                        Fechar Filtros
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

          <div className="flex-1" />
          <p className="text-xs font-bold text-modern-secondary bg-white px-4 py-2 rounded-none border border-modern-border shadow-sm">
            {filteredClients.length} resultados
          </p>
        </div>

        {/* Spreadsheet Area */}
        <div className="flex-1 overflow-hidden px-10 pb-10 flex flex-col">
          <div className="bg-white rounded-none border border-modern-border shadow-sm overflow-hidden flex flex-col flex-1">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-separate border-spacing-0 bg-white">
                <thead>
                  <tr className="bg-[#f8f9fa]">
                    <th className="sticky top-0 z-10 px-2 py-2 text-[11px] font-medium text-[#5f6368] text-center border-b border-r border-[#dadce0] bg-[#f8f9fa] w-10">#</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Cliente</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">WhatsApp / Telefone</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">E-mail</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Data/Hora</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Status Atual</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Total Investido</th>
                    <th className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-[#dadce0] bg-[#f8f9fa] text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {loading ? (
                    Array.from({ length: 20 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={8} className="px-3 py-2 h-10 border-b border-[#dadce0]" />
                      </tr>
                    ))
                  ) : filteredClients.map((client, idx) => {
                    const clientKey = client.email || client.telefone || client.nome;
                    const currentTag = clientTags[clientKey];
                    const lastLead = client.leads[0]; // Leads are sorted by timestamp desc

                    return (
                      <motion.tr 
                        key={clientKey}
                        onClick={() => setSelectedClient(client)}
                        className="group transition-colors cursor-pointer hover:bg-[#f1f3f4]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        <td className="px-2 py-2 border-b border-r border-[#dadce0] bg-[#f8f9fa] text-center text-[10px] text-[#5f6368] font-medium">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-none bg-modern-primary/10 flex items-center justify-center text-modern-primary font-bold text-[10px] shrink-0">
                              {client.nome.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-normal text-[#202124] truncate">{client.nome}</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(client.nome);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-none transition-all text-[#5f6368]"
                              title="Copiar nome"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center justify-between group/phone">
                            <p className="text-sm font-normal text-[#3c4043] flex items-center gap-2">
                              <Phone size={12} className="text-[#5f6368]" /> {client.telefone || <span className="text-rose-400 italic text-[10px]">Sem número</span>}
                            </p>
                            {client.telefone && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(client.telefone);
                                }}
                                className="opacity-0 group-hover/phone:opacity-100 p-1 hover:bg-gray-200 rounded-none transition-all text-[#5f6368]"
                                title="Copiar telefone"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <p className="text-sm font-normal text-[#5f6368] truncate max-w-[180px]">
                            {client.email}
                          </p>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex flex-col">
                            <p className="text-sm font-normal text-[#202124]">{lastLead?.data}</p>
                            <p className="text-[10px] text-[#5f6368]">{lastLead?.hora}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "px-1.5 py-0.5 rounded-none text-[10px] font-medium uppercase tracking-wider",
                              STATUS_THEMES[client.status]?.bg || "bg-slate-100",
                              STATUS_THEMES[client.status]?.text || "text-slate-500"
                            )}>
                              {client.status}
                            </div>
                            <div className={cn(
                              "px-1 py-0.5 rounded-none text-[9px] font-bold uppercase",
                              !currentTag ? "bg-blue-100 text-blue-600" :
                              currentTag === 'pendente' ? "bg-amber-100 text-amber-600" : 
                              currentTag === 'feito' ? "bg-emerald-100 text-emerald-600" :
                              "bg-rose-100 text-rose-600"
                            )}>
                              {!currentTag ? 'Enviar Msg' : 
                               currentTag === 'pendente' ? 'Pendente' : 
                               currentTag === 'feito' ? 'Feito' : 'Lixo'}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex flex-col">
                            <p className="text-sm font-semibold text-[#202124]">
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(client.totalSpent)}
                            </p>
                            <p className="text-[9px] text-[#5f6368] font-medium">
                              {client.leads.length} {client.leads.length === 1 ? 'Lead' : 'Leads'}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-[#dadce0]">
                          <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {client.telefone && (
                              <button 
                                onClick={() => copyToClipboard(`${client.nome} - ${client.telefone}`)}
                                className="w-6 h-6 rounded-none flex items-center justify-center transition-all border bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                                title="Copiar Nome + Tel"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                            <button 
                              onClick={() => toggleTag(clientKey, 'pendente')}
                              className={cn(
                                "w-6 h-6 rounded-none flex items-center justify-center transition-all border",
                                currentTag === 'pendente' 
                                  ? "bg-amber-100 border-amber-200 text-amber-600" 
                                  : "bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                              )}
                              title="Pendente (Aguardando Resposta)"
                            >
                              <Clock size={12} />
                            </button>
                            <button 
                              onClick={() => toggleTag(clientKey, 'feito')}
                              className={cn(
                                "w-6 h-6 rounded-none flex items-center justify-center transition-all border",
                                currentTag === 'feito' 
                                  ? "bg-emerald-100 border-emerald-200 text-emerald-600" 
                                  : "bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                              )}
                              title="Feito (Vendido)"
                            >
                              <CheckCircle2 size={12} />
                            </button>
                            <button 
                              onClick={() => toggleTag(clientKey, 'lixo')}
                              className={cn(
                                "w-6 h-6 rounded-none flex items-center justify-center transition-all border",
                                currentTag === 'lixo' 
                                  ? "bg-rose-100 border-rose-200 text-rose-600" 
                                  : "bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                              )}
                              title="Lixo (Número Inválido)"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Detail Panel - Modern Style */}
      <AnimatePresence>
        {selectedClient && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedClient(null)}
              className="fixed inset-0 z-40 bg-modern-text/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto custom-scrollbar flex flex-col"
            >
              <div className="p-10">
                <div className="flex items-center justify-between mb-12">
                  <button 
                    onClick={() => setSelectedClient(null)}
                    className="w-12 h-12 bg-slate-100 rounded-none flex items-center justify-center text-modern-secondary hover:text-modern-text transition-colors"
                  >
                    <X size={24} />
                  </button>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Última Atividade</p>
                    <p className="text-xs font-bold text-modern-text">{selectedClient.lastPurchaseDate}</p>
                  </div>
                </div>

                <div className="mb-12">
                  <h2 className="text-4xl font-extrabold tracking-tight text-modern-text mb-3 leading-tight">{selectedClient.nome}</h2>
                  <div className="flex flex-wrap gap-4 text-xs font-bold text-modern-secondary">
                    <p className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-none border border-modern-border"><Mail size={14} /> {selectedClient.email}</p>
                    <p className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-none border border-modern-border"><Phone size={14} /> {selectedClient.telefone}</p>
                  </div>
                </div>

                {/* History Section */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-8 h-8 bg-modern-primary/10 rounded-none flex items-center justify-center text-modern-primary">
                      <History size={18} />
                    </div>
                    <h4 className="text-xs font-extrabold uppercase tracking-[0.15em] text-modern-text">Histórico de Atividade</h4>
                  </div>

                  <div className="space-y-8">
                    {selectedClient.leads.map((lead) => (
                      <div key={lead.id} className="modern-card p-8 border-none shadow-sm bg-slate-50/50">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <p className="text-[10px] font-extrabold text-modern-secondary mb-2 flex items-center gap-2">
                              <Calendar size={12} /> {lead.data} • {lead.hora}
                            </p>
                            <h5 className="text-lg font-bold text-modern-text">{lead.produto}</h5>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-extrabold text-modern-primary mb-2">{lead.valor}</p>
                            <span className={cn(
                              "text-[9px] font-extrabold uppercase tracking-widest px-2 py-1 rounded-none shadow-sm",
                              STATUS_THEMES[lead.status]?.bg || "bg-slate-100",
                              STATUS_THEMES[lead.status]?.text || "text-slate-500"
                            )}>
                              {lead.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => handleGenerateMessage(lead)}
                            className="modern-button text-xs py-3 px-8"
                          >
                            Gerar Mensagem IA
                          </button>
                          <div className="flex-1" />
                          <p className="text-[10px] text-modern-secondary font-mono bg-white px-2 py-1 rounded-none border border-modern-border">ID: {lead.codPay}</p>
                        </div>

                        <AnimatePresence>
                          {generating && selectedLead?.id === lead.id && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-6 p-5 bg-modern-primary/5 rounded-none italic text-xs text-modern-primary font-medium border border-modern-primary/10"
                            >
                              Compondo abordagem personalizada com IA...
                            </motion.div>
                          )}
                          {generatedMessage && selectedLead?.id === lead.id && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-6 space-y-5"
                            >
                              <div className="relative">
                                <textarea 
                                  readOnly
                                  value={generatedMessage}
                                  className="w-full h-40 p-5 bg-white border border-modern-border rounded-none text-xs font-medium text-modern-text focus:outline-none resize-none leading-relaxed shadow-inner"
                                />
                                <button 
                                  onClick={() => copyToClipboard(generatedMessage)}
                                  className="absolute bottom-4 right-4 p-3 bg-white rounded-none shadow-lg border border-modern-border text-modern-secondary hover:text-modern-primary transition-all"
                                >
                                  {copied ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Copy size={16} />}
                                </button>
                              </div>
                              <div className="flex gap-4">
                                <a 
                                  href={`https://wa.me/${selectedClient.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(generatedMessage)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="modern-button flex-1 flex items-center justify-center gap-3"
                                >
                                  <ExternalLink size={16} /> Enviar WhatsApp
                                </a>
                                <button 
                                  onClick={() => {setGeneratedMessage(null); setSelectedLead(null);}}
                                  className="modern-button-secondary"
                                >
                                  Fechar
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="fixed inset-0 z-[60] bg-modern-text/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white shadow-2xl z-[70] p-8 rounded-none border border-modern-border"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-modern-primary/10 flex items-center justify-center text-modern-primary">
                    <Database size={18} />
                  </div>
                  <h3 className="text-lg font-bold text-modern-text">Sincronização com Planilha</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-modern-secondary hover:text-modern-text">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-blue-50 border border-blue-100 text-blue-800 text-xs leading-relaxed">
                  <p className="font-bold mb-1">Como configurar:</p>
                  <ol className="list-decimal ml-4 space-y-1">
                    <li>Na sua planilha, vá em <b>Extensões &gt; Apps Script</b>.</li>
                    <li>Cole o código que eu te passei no chat.</li>
                    <li>Clique em <b>Implantar &gt; Nova Implantação</b>.</li>
                    <li>Selecione <b>App da Web</b> e em "Quem tem acesso" escolha <b>Qualquer pessoa</b>.</li>
                    <li>Copie o URL gerado e cole abaixo.</li>
                  </ol>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">URL do Webhook (Apps Script)</label>
                  <input 
                    type="text" 
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                  />
                </div>

                <button 
                  onClick={() => {
                    localStorage.setItem('crm_webhook_url', webhookUrl);
                    setShowSettings(false);
                  }}
                  className="w-full bg-modern-primary text-white py-3 font-bold text-sm hover:bg-modern-primary/90 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={18} /> Salvar Configuração
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
