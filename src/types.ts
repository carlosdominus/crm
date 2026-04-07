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
  tag?: 'pendente' | 'feito' | 'lixo' | null;
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
};
