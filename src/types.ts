export interface Lead {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  produto: string;
  valor: string;
  status: string;
  codPay: string;
  data: string;
  hora: string;
  timestamp: number;
  numericValue: number;
  paymentMethod?: string;
  rowNumber?: number;
  // UTM Fields
  src?: string;
  sck?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ttcid?: string;
}

export interface ManualSale {
  id: string;
  clientKey: string;
  productName: string;
  value: number;
  commission: number;
  date: string;
  timestamp: number;
}

export interface Client {
  email: string;
  nome: string;
  telefone: string;
  key: string;
  leads: Lead[];
  totalSpent: number;
  lastPurchaseDate: string;
  lastPurchaseTimestamp: number;
  status: string; // Overall status (e.g., most recent)
  tag?: 'pendente' | 'vendido' | 'lixo' | null;
  manualSales?: ManualSale[];
}

export const FUNNEL_STEPS = [
  "Novos Leads",
  "Protocolo Força Natural",
  "Diagnóstico Personalizado",
  "Bônus Especial",
  "Tônico do Cavalo"
];

export const STATUS_THEMES: Record<string, { bg: string; text: string }> = {
  "Aprovado": { bg: "bg-emerald-500", text: "text-white" },
  "Pendente": { bg: "bg-amber-500", text: "text-black" },
  "Cancelado": { bg: "bg-rose-600", text: "text-white" },
  "Reembolsado": { bg: "bg-fortnite-blue", text: "text-white" },
  "Carrinho Abandonado": { bg: "bg-slate-400", text: "text-white" },
  "Expirado": { bg: "bg-orange-600", text: "text-white" },
  "Lixo": { bg: "bg-rose-100", text: "text-rose-600" },
};

export interface Workspace {
  ownerId: string;
  ownerEmail: string;
  collaborators: string[];
  collaboratorEmails?: Record<string, string>;
}

export interface UserMeta {
  uid: string;
  email: string;
  displayName?: string;
}

export interface Invitation {
  id?: string;
  email: string;
  senderId: string;
  senderEmail: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}
