// Shared types for calendar, cards, and drawer
export type Maybe<T> = T | null | undefined

export type Contact = {
  id?: Maybe<string>
  name: string
  company?: Maybe<string>
  phones?: string[]
  emails?: string[]
  address?: any
  tags?: string[]
  custom?: Record<string, any>
  pipeline?: { name?: string; stage?: string } | null
}

export type Job = {
  // ids
  id: string
  appointmentId?: string

  // schedule (we guarantee startTimeISO is present in the mapper)
  day?: string
  dateText?: string
  time?: string
  startTimeISO: string
  endTimeISO?: string

  // attributes
  jobType?: string
  estValue?: number
  territory?: string
  address?: any
  lat?: number
  lng?: number
  fitScore?: number

  // assignment
  assignedUserId?: string | null
  assignedRepName?: string | null
  vehicleName?: string | null
  travelMinutesFromPrev?: number | null

  // contact
  contact?: Contact
}