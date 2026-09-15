import { z } from 'zod';

const identifier = z.string().min(1).refine(value => value.trim().length > 0, 'Must not be blank');
export const externalJobIdSchema = identifier.refine(value => value !== '.' && value !== '..', 'Dot path segments are not valid job IDs')
  .describe('Your external job ID from your ATS, not the internal numeric JobZyn job ID.');

const jobFields = {
  id: externalJobIdSchema,
  title: identifier.describe('Job title.'),
  description: z.string().describe('Job description; HTML is supported and sanitized by JobZyn.').optional(),
  responsibilities: z.string().describe('Responsibilities; HTML is supported.').optional(),
  qualifications: z.string().describe('Qualifications; HTML is supported.').optional(),
  benefits: z.union([z.string(), z.array(z.string())]).describe('Benefits as text or a list.').optional(),
  city: z.union([z.string(), z.array(z.string())]).describe('One city or multiple cities.').optional(),
  country: z.string().describe('Country name. JobZyn defaults to Maroc on creation.').optional(),
  languages: z.array(z.enum(['fr', 'en', 'ar'])).optional(),
  contractType: z.enum(['CDI', 'CDD', 'Stage', 'Alternance', 'Freelance', 'VIE', 'Autre']).optional(),
  educationLevel: z.enum(['Non défini', 'Niveau BAC', 'BAC', 'BAC +1', 'BAC +1/2', 'BAC +3/4', 'BAC +5', 'BAC +5 et plus']).optional(),
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).optional(),
  minSalary: z.number().describe('Minimum net monthly salary.').optional(),
  maxSalary: z.number().describe('Maximum net monthly salary.').optional(),
  displaySalary: z.boolean().describe('Show salary publicly. JobZyn defaults to false on creation.').optional(),
  minExperience: z.number().min(0).max(20).describe('Minimum years of experience, between 0 and 20.').optional(),
  maxExperience: z.number().min(0).max(20).describe('Maximum years of experience, between 0 and 20.').optional(),
  status: z.enum(['PUBLISHED', 'UNPUBLISHED']).describe('Creation defaults to PUBLISHED and goes live immediately. Use UNPUBLISHED for a draft.').optional(),
  recruitmentProcess: z.array(z.string()).describe('Ordered recruitment steps.').optional(),
};

// JobZyn explicitly accepts and stores additional job fields. Never strip them.
export const createJobSchema = z.object(jobFields).catchall(z.json());
export const updateJobSchema = z.object(jobFields).partial().catchall(z.json());
export const createJobInput = z.strictObject({ job: createJobSchema });
export const updateJobInput = z.strictObject({ externalJobId: externalJobIdSchema, job: updateJobSchema });
export const unpublishJobInput = z.strictObject({ externalJobId: externalJobIdSchema });
const date = z.union([z.iso.datetime({ offset: true }), z.iso.date()]).describe('ISO 8601 date or timestamp with timezone, e.g. 2026-07-01T00:00:00Z.');
export const getCandidatesInput = z.strictObject({
  externalJobId: externalJobIdSchema,
  since: date.describe('Applications after this date; takes priority over from when both are supplied.').optional(),
  from: date.describe('Applications on or after this date; ignored by JobZyn when since is supplied.').optional(),
  to: date.describe('Applications on or before this date.').optional(),
  page: z.number().int().min(1).describe('Page number, starting at 1. JobZyn defaults to 1.').optional(),
  pageSize: z.number().int().min(1).max(100).describe('Results per page, at most 100. JobZyn defaults to 50.').optional(),
});
export const linkExternalIdsInput = z.strictObject({
  links: z.array(z.strictObject({
    jobzynJobId: z.number().describe('Internal numeric JobZyn job ID from the backoffice URL.'),
    externalJobId: externalJobIdSchema,
  })).describe('Mappings for existing JobZyn jobs. Existing external IDs are not overwritten.'),
});

export type CreateJob = z.infer<typeof createJobSchema>;
export type UpdateJob = z.infer<typeof updateJobSchema>;
export type CandidateQuery = Omit<z.infer<typeof getCandidatesInput>, 'externalJobId'>;
export type JobLink = z.infer<typeof linkExternalIdsInput>['links'][number];
