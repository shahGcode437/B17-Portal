/** A general business directory listing. Fictional prototype data only. */
export interface Business {
  id: string
  name: string
  category: string
  description: string
  area: string
  image?: string
  tags: string[]
  featured?: boolean
}
