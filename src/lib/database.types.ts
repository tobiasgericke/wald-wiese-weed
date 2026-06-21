export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          name: string
          first_name: string | null
          last_name: string | null
          is_admin: boolean
          created_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          first_name?: string | null
          last_name?: string | null
          is_admin?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          first_name?: string | null
          last_name?: string | null
          is_admin?: boolean
        }
      }
      festival_config: {
        Row: {
          id: number
          festival_name: string
          festival_date: string | null
          festival_start: string | null
          num_days: number
          daily_rate: number
          guest_daily_rate: number
          location: string | null
          bank_name: string | null
          bank_iban: string | null
          bank_recipient: string | null
          payment_deadline: string | null
          payment_reference: string | null
          notes: string | null
          donation_org1_name: string | null
          donation_org1_url: string | null
          donation_org1_description: string | null
          donation_org2_name: string | null
          donation_org2_url: string | null
          donation_org2_description: string | null
        }
        Insert: {
          festival_name?: string
          festival_date?: string | null
          festival_start?: string | null
          num_days?: number
          daily_rate?: number
          guest_daily_rate?: number
          location?: string | null
          bank_name?: string | null
          bank_iban?: string | null
          bank_recipient?: string | null
          payment_deadline?: string | null
          payment_reference?: string | null
          notes?: string | null
          donation_org1_name?: string | null
          donation_org1_url?: string | null
          donation_org1_description?: string | null
          donation_org2_name?: string | null
          donation_org2_url?: string | null
          donation_org2_description?: string | null
        }
        Update: {
          festival_name?: string
          festival_date?: string | null
          festival_start?: string | null
          num_days?: number
          daily_rate?: number
          guest_daily_rate?: number
          location?: string | null
          bank_name?: string | null
          bank_iban?: string | null
          bank_recipient?: string | null
          payment_deadline?: string | null
          payment_reference?: string | null
          notes?: string | null
          donation_org1_name?: string | null
          donation_org1_url?: string | null
          donation_org1_description?: string | null
          donation_org2_name?: string | null
          donation_org2_url?: string | null
          donation_org2_description?: string | null
        }
      }
      attendance: {
        Row: {
          id: string
          user_id: string
          day_index: number
          present: boolean
        }
        Insert: {
          id?: string
          user_id: string
          day_index: number
          present?: boolean
        }
        Update: {
          present?: boolean
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
      legacy_credits: {
        Row: {
          id: string
          display_name: string
          amount_owed: number
          matched_user_id: string | null
          match_confirmed: boolean
          created_at: string
        }
        Insert: {
          id?: string
          display_name: string
          amount_owed: number
          matched_user_id?: string | null
          match_confirmed?: boolean
          created_at?: string
        }
        Update: {
          matched_user_id?: string | null
          match_confirmed?: boolean
        }
      }
      legacy_credit_requests: {
        Row: {
          id: string
          legacy_credit_id: string
          requesting_user_id: string
          status: 'pending' | 'approved' | 'rejected'
          admin_note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          legacy_credit_id: string
          requesting_user_id: string
          status?: 'pending' | 'approved' | 'rejected'
          admin_note?: string | null
          created_at?: string
        }
        Update: {
          status?: 'pending' | 'approved' | 'rejected'
          admin_note?: string | null
        }
      }
      legacy_credit_decisions: {
        Row: {
          id: string
          legacy_credit_id: string
          user_id: string
          decision: 'refund' | 'apply_www7' | 'donate_www' | 'donate_org1' | 'donate_org2'
          decided_at: string
        }
        Insert: {
          id?: string
          legacy_credit_id: string
          user_id: string
          decision: 'refund' | 'apply_www7' | 'donate_www' | 'donate_org1' | 'donate_org2'
          decided_at?: string
        }
        Update: {
          decision?: 'refund' | 'apply_www7' | 'donate_www' | 'donate_org1' | 'donate_org2'
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
export type Attendance = Database['public']['Tables']['attendance']['Row']
export type LegacyCredit = Database['public']['Tables']['legacy_credits']['Row']
export type LegacyCreditRequest = Database['public']['Tables']['legacy_credit_requests']['Row']
export type LegacyCreditDecision = Database['public']['Tables']['legacy_credit_decisions']['Row']
export type LegacyDecisionType = LegacyCreditDecision['decision']
