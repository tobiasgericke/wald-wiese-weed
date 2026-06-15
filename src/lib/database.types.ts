export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          name: string
          is_admin: boolean
          created_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          is_admin?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          is_admin?: boolean
        }
      }
      festival_config: {
        Row: {
          id: number
          festival_name: string
          festival_date: string | null
          location: string | null
          bank_name: string | null
          bank_iban: string | null
          bank_recipient: string | null
          payment_deadline: string | null
          notes: string | null
        }
        Insert: {
          festival_name?: string
          festival_date?: string | null
          location?: string | null
          bank_name?: string | null
          bank_iban?: string | null
          bank_recipient?: string | null
          payment_deadline?: string | null
          notes?: string | null
        }
        Update: {
          festival_name?: string
          festival_date?: string | null
          location?: string | null
          bank_name?: string | null
          bank_iban?: string | null
          bank_recipient?: string | null
          payment_deadline?: string | null
          notes?: string | null
        }
      }
      cost_items: {
        Row: {
          id: string
          name: string
          amount: number
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          amount: number
          description?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          amount?: number
          description?: string | null
        }
      }
      participant_payments: {
        Row: {
          id: string
          user_id: string
          amount_due: number
          amount_paid: number
          paid: boolean
          paid_at: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount_due?: number
          amount_paid?: number
          paid?: boolean
          paid_at?: string | null
          notes?: string | null
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          paid?: boolean
          paid_at?: string | null
          notes?: string | null
        }
      }
    }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type FestivalConfig = Database['public']['Tables']['festival_config']['Row']
export type CostItem = Database['public']['Tables']['cost_items']['Row']
export type ParticipantPayment = Database['public']['Tables']['participant_payments']['Row']
