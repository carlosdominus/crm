import React, { useState, useEffect, useMemo, useDeferredValue, useRef } from 'react';
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
  Mail,
  LayoutDashboard,
  Plus,
  TrendingUp,
  DollarSign,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parse, getTime, startOfDay, endOfDay, startOfWeek, startOfMonth, isWithinInterval, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  User,
  handleFirestoreError,
  OperationType
} from './firebase';

import { Lead, Client, STATUS_THEMES, ManualSale } from './types';
import { cn } from './lib/utils';
import { generatePersonalizedMessage } from './services/gemini';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1_rVWRk6_Knv5WLRONjC-wh_vFH6SymnTTFxbwqn-ehY/export?format=csv";

const MANUAL_PRODUCTS = [
  { name: "Protocolo Força Natural", type: 'front', commissionRate: 0.5 },
  { name: "Diagnóstico Personalizado", type: 'upsell', commissionRate: 0.5 },
  { name: "Bônus Especial", type: 'upsell', commissionRate: 0.5 },
  { name: "Tônico do Cavalo", type: 'upsell', commissionRate: 0.5 },
  { name: "Nutra Libid Turbo Caps", type: 'nutra', commissionRate: 0.23401 },
];

const PAYMENT_METHODS: Record<string, string> = {
  "0": "Nenhum",
  "1": "Cartão de Crédito",
  "2": "Boleto Bancário",
  "3": "PayPal",
  "4": "Cartão Recorrente",
  "5": "Gratuito",
  "6": "Cartão Upsell",
  "7": "Pix"
};

const cleanPhone = (phone: string): string => {
  if (!phone) return "";
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle double DDI (5555...)
  // If it starts with 5555 and is long, it's likely a double DDI
  if (cleaned.startsWith('5555') && cleaned.length >= 14) {
    cleaned = cleaned.substring(2);
  }
  
  // Ensure it starts with 55 if it's a Brazilian number (10 or 11 digits without DDI)
  if (cleaned.length === 10 || cleaned.length === 11) {
    if (!cleaned.startsWith('55')) {
      cleaned = '55' + cleaned;
    } else {
      // If it starts with 55 and has 11 digits, it could be DDD 55 + 9 digits (total 11)
      // or it could be DDI 55 + DDD + 7 digits (total 11 - invalid).
      // In Brazil, if it's 11 digits and starts with 55, it's almost always DDD 55 + 9 digits.
      // So we add 55 DDI.
      cleaned = '55' + cleaned;
    }
  }
  
  return cleaned;
};

const isValidPhone = (phone: string): boolean => {
  const cleaned = cleanPhone(phone);
  // Brazilian numbers with DDI: 55 + DDD (2) + Number (8 or 9)
  // Mobile: 55 + DDD + 9XXXXXXXX (13 digits)
  // Landline or Mobile without the extra 9: 55 + DDD + XXXXXXXX (12 digits)
  if (cleaned.length === 13) {
    return cleaned.startsWith('55') && cleaned[4] === '9';
  }
  if (cleaned.length === 12) {
    return cleaned.startsWith('55');
  }
  return false;
};

export default function App() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
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
  const [view, setView] = useState<'crm' | 'dashboard'>('crm');
  
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Erro ao fazer login:", error);
      setAuthError(error.message || "Erro desconhecido ao fazer login");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    }
  };

  // Migration logic: Move local data to cloud upon login
  useEffect(() => {
    if (user) {
      const migrateData = async () => {
        const localSales = localStorage.getItem('crm_manual_sales');
        const localTags = localStorage.getItem('crm_client_tags');

        if (localSales) {
          try {
            const sales = JSON.parse(localSales) as ManualSale[];
            for (const sale of sales) {
              await setDoc(doc(db, `users/${user.uid}/sales`, sale.id), sale);
            }
            localStorage.removeItem('crm_manual_sales');
          } catch (e) {
            console.error("Erro ao migrar vendas:", e);
          }
        }

        if (localTags) {
          try {
            const tags = JSON.parse(localTags) as Record<string, any>;
            for (const [clientKey, rawTag] of Object.entries(tags)) {
              // Normalize tag names if they are old
              let tag = rawTag;
              if (tag === 'entrar em contato') tag = 'pendente';
              else if (tag === 'contato enviado') tag = 'feito';

              if (tag) {
                await setDoc(doc(db, `users/${user.uid}/tags`, clientKey), {
                  clientKey,
                  tag,
                  updatedAt: new Date().toISOString()
                });
              }
            }
            localStorage.removeItem('crm_client_tags');
          } catch (e) {
            console.error("Erro ao migrar tags:", e);
          }
        }
      };
      migrateData();
    }
  }, [user]);

  // Pagination state
  const [visibleCount, setVisibleCount] = useState(50);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  
  // Manual Sales state
  const [manualSales, setManualSales] = useState<ManualSale[]>([]);

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      const saved = localStorage.getItem('crm_manual_sales');
      setManualSales(saved ? JSON.parse(saved) : []);
      return;
    }

    const q = query(collection(db, `users/${user.uid}/sales`), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sales = snapshot.docs.map(doc => doc.data() as ManualSale);
      setManualSales(sales);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sales`);
    });

    return () => unsubscribe();
  }, [authReady, user]);

  const [showAddSaleModal, setShowAddSaleModal] = useState(false);
  const [saleForm, setSaleForm] = useState({
    productIndex: 0,
    value: "",
    date: format(new Date(), 'yyyy-MM-dd')
  });

  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [showOnlyManualSales, setShowOnlyManualSales] = useState(false);
  
  // Tagging state
  const [clientTags, setClientTags] = useState<Record<string, 'pendente' | 'feito' | 'lixo' | null>>({});

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      const saved = localStorage.getItem('crm_client_tags');
      if (saved) {
        const parsed = JSON.parse(saved);
        const migrated: Record<string, any> = {};
        Object.entries(parsed).forEach(([key, val]) => {
          if (val === 'entrar em contato') migrated[key] = 'pendente';
          else if (val === 'contato enviado') migrated[key] = 'feito';
          else migrated[key] = val;
        });
        setClientTags(migrated);
      } else {
        setClientTags({});
      }
      return;
    }

    const unsubscribe = onSnapshot(collection(db, `users/${user.uid}/tags`), (snapshot) => {
      const tags: Record<string, 'pendente' | 'feito' | 'lixo' | null> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        tags[data.clientKey] = data.tag;
      });
      setClientTags(tags);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/tags`);
    });

    return () => unsubscribe();
  }, [authReady, user]);

  const toggleTag = async (clientKey: string, tag: 'pendente' | 'feito' | 'lixo') => {
    const newTag = clientTags[clientKey] === tag ? null : tag;

    if (!user) {
      const updatedTags = { ...clientTags, [clientKey]: newTag };
      setClientTags(updatedTags);
      localStorage.setItem('crm_client_tags', JSON.stringify(updatedTags));
      return;
    }
    
    try {
      const tagRef = doc(db, `users/${user.uid}/tags`, clientKey);
      if (newTag === null) {
        await deleteDoc(tagRef);
      } else {
        await setDoc(tagRef, {
          clientKey,
          tag: newTag,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/tags/${clientKey}`);
    }

    // Sync to Google Sheets if webhook is configured
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'tag_update',
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

  useEffect(() => {
    setVisibleCount(50);
  }, [deferredSearchTerm, statusFilter, tagFilter, filterType]);

  const handleAddSale = async () => {
    if (!selectedClient || !saleForm.value) return;

    const product = MANUAL_PRODUCTS[saleForm.productIndex] as any;
    const value = parseFloat(saleForm.value.replace(',', '.'));
    const commission = product.fixedCommission !== undefined ? product.fixedCommission : value * (product.commissionRate || 0);
    
    const saleId = Math.random().toString(36).substr(2, 9);
    const newSale: ManualSale = {
      id: saleId,
      clientKey: selectedClient.key,
      productName: product.name,
      value,
      commission,
      date: saleForm.date,
      timestamp: new Date(saleForm.date).getTime()
    };

    if (!user) {
      const updatedSales = [newSale, ...manualSales];
      setManualSales(updatedSales);
      localStorage.setItem('crm_manual_sales', JSON.stringify(updatedSales));
      setShowAddSaleModal(false);
      setSaleForm({
        productIndex: 0,
        value: "",
        date: format(new Date(), 'yyyy-MM-dd')
      });
      toggleTag(newSale.clientKey, 'feito');
      return;
    }

    try {
      await setDoc(doc(db, `users/${user.uid}/sales`, saleId), newSale);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/sales/${saleId}`);
    }

    setShowAddSaleModal(false);
    setSaleForm({
      productIndex: 0,
      value: "",
      date: format(new Date(), 'yyyy-MM-dd')
    });
    
    // Sync sale to Google Sheets if webhook is configured
    if (webhookUrl) {
      try {
        fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sale_added',
            sale: newSale,
            clientKey: newSale.clientKey,
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error("Erro ao sincronizar venda com a planilha:", error);
      }
    }

    // Also update the tag to 'feito'
    toggleTag(newSale.clientKey, 'feito');
  };

  const handleDeleteSale = async (saleId: string) => {
    const saleToDelete = manualSales.find(s => s.id === saleId);

    if (!user) {
      const updatedSales = manualSales.filter(s => s.id !== saleId);
      setManualSales(updatedSales);
      localStorage.setItem('crm_manual_sales', JSON.stringify(updatedSales));
    } else {
      try {
        await deleteDoc(doc(db, `users/${user.uid}/sales`, saleId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sales/${saleId}`);
      }
    }

    // Sync deletion to Google Sheets if webhook is configured
    if (webhookUrl && saleToDelete) {
      try {
        fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sale_deleted',
            saleId: saleId,
            clientKey: saleToDelete.clientKey,
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error("Erro ao sincronizar exclusão de venda:", error);
      }
    }
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
          const paymentMethodKey = results.meta.fields?.[11]; // Column L

          const rawLeads: Lead[] = results.data.map((row: any, index: number) => {
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

            const isEmail = (val: string) => val.includes('@');
            
            if (isEmail(telefoneRaw) && !isEmail(emailRaw)) {
              const temp = telefoneRaw;
              telefoneRaw = emailRaw;
              emailRaw = temp;
            } else if (!isEmail(emailRaw) && isEmail(telefoneRaw)) {
              emailRaw = telefoneRaw;
              telefoneRaw = '';
            }

            const cleanedTelefone = cleanPhone(telefoneRaw);

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
            } else if (rawStatus.startsWith('expired') || rawStatus === 'expirado') {
              normalizedStatus = 'Expirado';
            } else if (rawStatus === 'lixo' || (row['tag'] && row['tag'].toString().toLowerCase().trim() === 'lixo')) {
              normalizedStatus = 'Lixo';
            }

            return {
              id: row['id'] || Math.random().toString(36).substr(2, 9),
              nome: (row['nome'] || 'Sem Nome').trim(),
              telefone: cleanedTelefone,
              email: emailRaw,
              produto: (row['produto'] || '').trim(),
              valor: isNaN(leadValue) ? 'R$ 0,00' : `R$ ${leadValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
              status: normalizedStatus,
              codPay: (row['cod pay'] || '').trim(),
              data: dateStr,
              hora: timeStr,
              timestamp,
              numericValue: isNaN(leadValue) ? 0 : leadValue,
              paymentMethod: paymentMethodKey ? PAYMENT_METHODS[row[paymentMethodKey]?.toString()] || 'Desconhecido' : undefined,
              rowNumber: index + 2
            };
          });

          const clientsList: Client[] = [];
          const emailMap = new Map<string, Client>();
          const phoneMap = new Map<string, Client>();
          const nameMap = new Map<string, Client>();
          const newTags = { ...clientTags };
          let tagsChanged = false;
          
          rawLeads.forEach(lead => {
            const emailKey = lead.email?.toLowerCase().trim();
            const phoneKey = lead.telefone?.trim();
            const nameKey = lead.nome?.toLowerCase().trim();
            
            // If lead is explicitly marked as 'lixo' in the spreadsheet, set the tag
            if (lead.status === 'Lixo') {
              const clientKey = (lead.email || lead.telefone || lead.nome).toLowerCase().trim();
              if (newTags[clientKey] !== 'lixo') {
                newTags[clientKey] = 'lixo';
                tagsChanged = true;
              }
            }
            let existing: Client | undefined;
            if (emailKey && emailMap.has(emailKey)) {
              existing = emailMap.get(emailKey);
            } else if (phoneKey && phoneMap.has(phoneKey)) {
              existing = phoneMap.get(phoneKey);
            } else if (nameKey && nameMap.has(nameKey) && nameKey !== 'sem nome') {
              // Fallback to name merging if no email/phone match
              existing = nameMap.get(nameKey);
            }

            if (existing) {
              existing.leads.push(lead);
              
              // Update with better data if available
              // Prioritize valid phones over invalid/empty ones
              const currentPhoneValid = isValidPhone(existing.telefone);
              const newPhoneValid = isValidPhone(lead.telefone);

              if (!currentPhoneValid && newPhoneValid) {
                existing.telefone = lead.telefone;
                if (lead.telefone) phoneMap.set(lead.telefone, existing);
              } else if (!existing.telefone && lead.telefone) {
                existing.telefone = lead.telefone;
                if (lead.telefone) phoneMap.set(lead.telefone, existing);
              }

              if (!existing.email && lead.email) {
                existing.email = lead.email;
                emailMap.set(lead.email.toLowerCase().trim(), existing);
              }
              if (existing.nome === 'Sem Nome' && lead.nome !== 'Sem Nome') {
                existing.nome = lead.nome;
                if (nameKey) nameMap.set(nameKey, existing);
              }
              
              const leadValue = lead.numericValue;
              const isAprovado = lead.status === 'Aprovado';
              if (isAprovado) {
                existing.totalSpent += leadValue;
                existing.status = 'Aprovado';
              }
              
              if (lead.timestamp > existing.lastPurchaseTimestamp) {
                existing.lastPurchaseDate = lead.data;
                existing.lastPurchaseTimestamp = lead.timestamp;
                if (existing.status !== 'Aprovado') {
                  existing.status = lead.status;
                }
              }
            } else {
              const clientKey = (lead.email || lead.telefone || lead.nome).toLowerCase().trim();
              const newClient: Client = {
                email: lead.email,
                nome: lead.nome,
                telefone: lead.telefone,
                key: clientKey,
                leads: [lead],
                totalSpent: lead.status === 'Aprovado' ? lead.numericValue : 0,
                lastPurchaseDate: lead.data,
                lastPurchaseTimestamp: lead.timestamp,
                status: lead.status
              };
              clientsList.push(newClient);
              if (emailKey) emailMap.set(emailKey, newClient);
              if (phoneKey) phoneMap.set(phoneKey, newClient);
              if (nameKey && nameKey !== 'sem nome') nameMap.set(nameKey, newClient);
            }
          });

          // Final pass to auto-tag 'lixo' only if NO valid phone exists for the client
          clientsList.forEach(client => {
            const hasValidPhone = isValidPhone(client.telefone) || client.leads.some(l => isValidPhone(l.telefone));
            if (!hasValidPhone) {
              if (!newTags[client.key]) {
                newTags[client.key] = 'lixo';
                tagsChanged = true;
              }
            } else if (newTags[client.key] === 'lixo' && hasValidPhone) {
              // If we have a valid phone now, remove the 'lixo' tag automatically
              // This fixes cases like Geovane where a valid number was finally found
              delete newTags[client.key];
              tagsChanged = true;
            }
          });

          const sortedClients = clientsList.map(client => ({
            ...client,
            leads: client.leads.sort((a, b) => {
              if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
              if (b.status === 'Aprovado' && a.status !== 'Aprovado') return 1;
              if (a.status === 'Aprovado' && b.status !== 'Aprovado') return -1;
              return 0;
            })
          })).sort((a, b) => b.lastPurchaseTimestamp - a.lastPurchaseTimestamp);

          if (tagsChanged) setClientTags(newTags);

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

    const manualSalesKeys = new Set(manualSales.map(s => s.clientKey));

    return clients.filter(client => {
      const clientKey = client.key;
      const tag = clientTags[clientKey] || 'enviar msg';

      if (showOnlyManualSales && !manualSalesKeys.has(clientKey)) return false;

      const matchesSearch = 
        client.nome.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
        client.email.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
        client.telefone.includes(deferredSearchTerm);
      
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
  }, [clients, deferredSearchTerm, filterType, customStartDate, customEndDate, statusFilter, tagFilter, clientTags, showOnlyManualSales, manualSales]);

  const pagedClients = useMemo(() => {
    return filteredClients.slice(0, visibleCount);
  }, [filteredClients, visibleCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 100) {
      if (visibleCount < filteredClients.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const stats = useMemo(() => {
    const totalClients = clients.length;
    const activeClients = clients.filter(c => c.leads.some(l => l.status === 'Aprovado')).length;
    const totalRevenue = clients.reduce((acc, curr) => acc + curr.totalSpent, 0);
    
    const manualRevenue = manualSales.reduce((acc, curr) => acc + curr.value, 0);
    const totalCommission = manualSales.reduce((acc, curr) => acc + curr.commission, 0);

    const currentMonthKey = format(new Date(), 'yyyy-MM');
    const currentMonthCommission = manualSales
      .filter(s => {
        const [year, month] = s.date.split('-');
        return `${year}-${month}` === currentMonthKey;
      })
      .reduce((acc, curr) => acc + curr.commission, 0);

    return { totalClients, activeClients, totalRevenue, manualRevenue, totalCommission, currentMonthCommission };
  }, [clients, manualSales]);

  const dashboardData = useMemo(() => {
    const dailyMap = new Map<string, { date: string; value: number; commission: number; count: number }>();
    
    manualSales.forEach(sale => {
      const date = sale.date;
      const existing = dailyMap.get(date) || { date, value: 0, commission: 0, count: 0 };
      existing.value += sale.value;
      existing.commission += sale.commission;
      existing.count += 1;
      dailyMap.set(date, existing);
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [manualSales]);

  const monthlyData = useMemo(() => {
    const monthlyMap = new Map<string, { month: string; monthName: string; value: number; commission: number; count: number }>();
    
    manualSales.forEach(sale => {
      const [year, month, day] = sale.date.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const monthKey = format(date, 'yyyy-MM');
      const monthName = format(date, 'MMMM yyyy', { locale: ptBR });
      
      const existing = monthlyMap.get(monthKey) || { month: monthKey, monthName, value: 0, commission: 0, count: 0 };
      existing.value += sale.value;
      existing.commission += sale.commission;
      existing.count += 1;
      monthlyMap.set(monthKey, existing);
    });

    return Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month));
  }, [manualSales]);

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
              <h1 className="text-lg font-bold tracking-tight text-modern-text">Dominus CRM</h1>
              <div className="h-4 w-px bg-modern-border" />
              <p className="text-xs font-semibold text-modern-secondary">Controle de Leads</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button 
                onClick={() => setShowOnlyManualSales(!showOnlyManualSales)}
                className={cn(
                  "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all",
                  showOnlyManualSales 
                    ? "bg-emerald-600 border-emerald-600 text-white" 
                    : "bg-white border-modern-border text-modern-secondary hover:border-modern-primary"
                )}
              >
                {showOnlyManualSales ? "Mostrando: Com Vendas" : "Filtrar: Com Vendas"}
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden lg:flex gap-6">
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Minha Comissão</p>
                <p className="text-sm font-bold text-emerald-600">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalCommission)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Vendas Manuais</p>
                <p className="text-sm font-bold text-modern-text">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.manualRevenue)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Total Planilha</p>
                <p className="text-sm font-bold text-modern-text">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalRevenue)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setView(view === 'crm' ? 'dashboard' : 'crm')}
                className={cn(
                  "w-10 h-10 border border-modern-border rounded-none flex items-center justify-center transition-all shadow-sm",
                  view === 'dashboard' ? "bg-modern-primary text-white" : "bg-white text-modern-secondary hover:text-modern-primary"
                )}
                title={view === 'crm' ? "Ver Dashboard" : "Ver CRM"}
              >
                {view === 'crm' ? <LayoutDashboard size={18} /> : <Users size={18} />}
              </button>
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
        
        <div className="flex-1 overflow-hidden flex flex-col">
          {view === 'crm' ? (
            <>
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
            <div 
              ref={tableContainerRef}
              onScroll={handleScroll}
              className="overflow-auto custom-scrollbar flex-1"
            >
              <table className="w-full text-left border-separate border-spacing-0 bg-white">
                <thead>
                  <tr className="bg-[#f8f9fa]">
                    <th className="sticky top-0 z-20 px-2 py-2 text-[11px] font-medium text-[#5f6368] text-center border-b border-r border-[#dadce0] bg-[#f8f9fa] w-16">Linha</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa] text-center">Ações</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Cliente</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">WhatsApp / Telefone</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">E-mail</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Data/Hora</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Status Atual</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-[#dadce0] bg-[#f8f9fa]">Total Investido</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {loading ? (
                    Array.from({ length: 20 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={8} className="px-3 py-2 h-10 border-b border-[#dadce0]" />
                      </tr>
                    ))
                  ) : pagedClients.map((client, idx) => {
                    const clientKey = client.key;
                    const currentTag = clientTags[clientKey];
                    
                    const lastLead = client.leads[0]; // Leads are sorted by timestamp desc

                    return (
                      <motion.tr 
                        key={clientKey}
                        onClick={() => setSelectedClient(client)}
                        className="group transition-colors cursor-pointer hover:bg-[#f1f3f4]"
                        initial={false}
                        animate={{ opacity: 1 }}
                      >
                        <td className="px-2 py-2 border-b border-r border-[#dadce0] bg-[#f8f9fa] text-center text-[10px] text-[#5f6368] font-medium">
                          {lastLead?.rowNumber || '-'}
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
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
                        <td className="px-3 py-2 border-b border-[#dadce0]">
                          <div className="flex flex-col">
                            <p className="text-sm font-semibold text-[#202124]">
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(client.totalSpent)}
                            </p>
                            <p className="text-[9px] text-[#5f6368] font-medium">
                              {client.leads.length} {client.leads.length === 1 ? 'Lead' : 'Leads'}
                            </p>
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
      </>
    ) : (
      <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
          {/* Dashboard Header Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-emerald-600 flex items-center justify-center text-white">
                  <TrendingUp size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Comissão (Mês Atual)</p>
              </div>
              <p className="text-4xl font-extrabold text-emerald-600">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.currentMonthCommission)}
              </p>
            </div>
            
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <DollarSign size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Comissão Total</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-text">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalCommission)}
              </p>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-blue-100 flex items-center justify-center text-blue-600">
                  <Package size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Total de Vendas</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-text">{manualSales.length}</p>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-slate-100 flex items-center justify-center text-slate-600">
                  <Users size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Clientes Atendidos</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-text">{new Set(manualSales.map(s => s.clientKey)).size}</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10">Evolução de Comissão Diária</h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dashboardData}>
                    <defs>
                      <linearGradient id="colorComm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                      tickFormatter={(val) => {
                        const [year, month, day] = val.split('-');
                        return `${day}/${month}`;
                      }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                      tickFormatter={(val) => `R$ ${val}`}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      labelStyle={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}
                    />
                    <Area type="monotone" dataKey="commission" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorComm)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10">Volume de Vendas Diário</h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboardData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                      tickFormatter={(val) => {
                        const [year, month, day] = val.split('-');
                        return `${day}/${month}`;
                      }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Monthly Commission Table */}
          <div className="bg-white border border-modern-border p-10 shadow-sm">
            <div className="flex items-center justify-between mb-10">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text">Resumo de Comissão por Mês</h3>
              <div className="flex items-center gap-2 text-emerald-600">
                <Calendar size={16} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Histórico Mensal</span>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border">Mês</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border text-center">Vendas</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border text-right">Faturamento</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.length > 0 ? (
                    monthlyData.map((data) => (
                      <tr key={data.month} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-5 text-sm font-bold text-modern-text border-b border-modern-border capitalize">
                          {data.monthName}
                        </td>
                        <td className="px-6 py-5 text-sm font-bold text-modern-secondary border-b border-modern-border text-center">
                          {data.count}
                        </td>
                        <td className="px-6 py-5 text-sm font-bold text-modern-text border-b border-modern-border text-right">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.value)}
                        </td>
                        <td className="px-6 py-5 text-sm font-extrabold text-emerald-600 border-b border-modern-border text-right">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.commission)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-[11px] font-bold text-modern-secondary uppercase tracking-wider border-b border-modern-border">
                        Nenhuma venda registrada para gerar o histórico mensal
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Sales Table */}
          <div className="bg-white border border-modern-border shadow-sm overflow-hidden">
            <div className="p-8 border-b border-modern-border bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text">Histórico de Vendas Manuais</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-modern-border">
                    <th className="px-8 py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest">Data</th>
                    <th className="px-8 py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest">Produto</th>
                    <th className="px-8 py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest">Valor</th>
                    <th className="px-8 py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-modern-border">
                  {manualSales.sort((a, b) => b.timestamp - a.timestamp).map(sale => (
                    <tr key={sale.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-5 text-sm font-bold text-modern-text">
                        {(() => {
                          const [year, month, day] = sale.date.split('-');
                          return `${day}/${month}/${year}`;
                        })()}
                      </td>
                      <td className="px-8 py-5 text-sm font-medium text-modern-text">{sale.productName}</td>
                      <td className="px-8 py-5 text-sm font-bold text-modern-text">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.value)}
                      </td>
                      <td className="px-8 py-5 text-sm font-extrabold text-emerald-600 text-right">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.commission)}
                      </td>
                    </tr>
                  ))}
                  {manualSales.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-8 py-20 text-center text-sm font-bold text-modern-secondary uppercase tracking-widest">
                        Nenhuma venda registrada ainda
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
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

                {/* Manual Sales Section */}
                <div className="mb-12 border-b border-modern-border pb-12">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-emerald-100 rounded-none flex items-center justify-center text-emerald-600">
                        <DollarSign size={18} />
                      </div>
                      <h4 className="text-xs font-extrabold uppercase tracking-[0.15em] text-modern-text">Vendas Diretas (WhatsApp)</h4>
                    </div>
                    <button 
                      onClick={() => setShowAddSaleModal(true)}
                      className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 text-[11px] font-bold hover:bg-emerald-700 transition-all shadow-sm"
                    >
                      <Plus size={16} /> Registrar Venda
                    </button>
                  </div>

                  <div className="space-y-4">
                    {manualSales.filter(s => s.clientKey === selectedClient.key).length > 0 ? (
                      manualSales
                        .filter(s => s.clientKey === selectedClient.key)
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .map(sale => (
                          <div key={sale.id} className="bg-slate-50 border border-modern-border p-5 flex items-center justify-between group/sale">
                            <div>
                              <p className="text-sm font-bold text-modern-text">{sale.productName}</p>
                              <p className="text-[10px] font-bold text-modern-secondary uppercase tracking-wider">
                                {(() => {
                                  const [year, month, day] = sale.date.split('-');
                                  return `${day}/${month}/${year}`;
                                })()}
                              </p>
                            </div>
                            <div className="flex items-center gap-6">
                              <div className="text-right">
                                <p className="text-sm font-extrabold text-emerald-600">
                                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.value)}
                                </p>
                                <p className="text-[9px] font-bold text-modern-secondary uppercase">
                                  Comissão: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.commission)}
                                </p>
                              </div>
                              <button 
                                onClick={() => handleDeleteSale(sale.id)}
                                className="opacity-0 group-hover/sale:opacity-100 p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                                title="Excluir Venda"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="text-center py-10 bg-slate-50 border border-dashed border-modern-border">
                        <p className="text-[11px] font-bold text-modern-secondary uppercase tracking-wider">Nenhuma venda manual registrada</p>
                      </div>
                    )}
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
                            <div className="flex flex-col items-end gap-2">
                              <span className={cn(
                                "text-[9px] font-extrabold uppercase tracking-widest px-2 py-1 rounded-none shadow-sm",
                                STATUS_THEMES[lead.status]?.bg || "bg-slate-100",
                                STATUS_THEMES[lead.status]?.text || "text-slate-500"
                              )}>
                                {lead.status}
                              </span>
                              {lead.paymentMethod && (
                                <span className="text-[8px] font-bold text-modern-secondary uppercase tracking-wider bg-white border border-modern-border px-2 py-0.5">
                                  {lead.paymentMethod}
                                </span>
                              )}
                            </div>
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

                <div className="pt-4 border-t border-modern-border">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary mb-4 block">Sincronização em Nuvem (Multi-dispositivo)</label>
                  {authError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                      Erro: {authError}
                    </div>
                  )}
                  {user ? (
                    <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-100">
                      <div className="flex items-center gap-3">
                        {user.photoURL && <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />}
                        <div>
                          <p className="text-xs font-bold text-modern-text">{user.displayName}</p>
                          <p className="text-[10px] text-emerald-600 font-medium">Sincronizado na Nuvem</p>
                        </div>
                      </div>
                      <button 
                        onClick={handleLogout}
                        className="text-[10px] font-bold uppercase tracking-wider text-red-600 hover:underline"
                      >
                        Sair
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={handleLogin}
                      className="w-full py-4 bg-modern-text text-white font-bold text-xs uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-3"
                    >
                      <Users size={18} /> Entrar com Google para Sincronizar
                    </button>
                  )}
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
      {/* Add Sale Modal */}
      <AnimatePresence>
        {showAddSaleModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddSaleModal(false)}
              className="fixed inset-0 z-[60] bg-modern-text/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white shadow-2xl z-[70] p-8 rounded-none border border-modern-border"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <DollarSign size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-modern-text uppercase tracking-widest">Registrar Venda</h3>
                    <p className="text-[10px] font-bold text-modern-secondary uppercase tracking-wider">{selectedClient?.nome}</p>
                  </div>
                </div>
                <button onClick={() => setShowAddSaleModal(false)} className="text-modern-secondary hover:text-modern-text">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Produto Vendido</label>
                  <select 
                    value={saleForm.productIndex}
                    onChange={(e) => setSaleForm({ ...saleForm, productIndex: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                  >
                    {MANUAL_PRODUCTS.map((p: any, i) => (
                      <option key={i} value={i}>{p.name} ({p.fixedCommission !== undefined ? `R$ ${p.fixedCommission.toFixed(2)}` : `${(p.commissionRate || 0) * 100}%`})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Valor da Venda (R$)</label>
                  <input 
                    type="text" 
                    value={saleForm.value}
                    onChange={(e) => setSaleForm({ ...saleForm, value: e.target.value })}
                    placeholder="Ex: 97,00"
                    className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Data da Venda</label>
                  <input 
                    type="date" 
                    value={saleForm.date}
                    onChange={(e) => setSaleForm({ ...saleForm, date: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                  />
                </div>

                <div className="pt-4">
                  <div className="bg-emerald-50 p-4 border border-emerald-100 mb-6">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Sua Comissão Estimada:</p>
                      <p className="text-lg font-extrabold text-emerald-600">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                          (() => {
                            const p = MANUAL_PRODUCTS[saleForm.productIndex] as any;
                            if (p.fixedCommission !== undefined) return p.fixedCommission;
                            return (parseFloat(saleForm.value.replace(',', '.')) || 0) * (p.commissionRate || 0);
                          })()
                        )}
                      </p>
                    </div>
                  </div>

                  <button 
                    onClick={handleAddSale}
                    disabled={!saleForm.value}
                    className="w-full bg-emerald-600 text-white py-4 font-bold text-sm hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <CheckCircle2 size={18} /> Confirmar Venda
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
