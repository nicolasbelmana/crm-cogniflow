/**
 * Translates HTTP requests into leadsService calls and results into
 * responses. No SQL, no validation rules here — just mapping.
 */
export function createLeadsController({ leadsService }) {
  return {
    async list(req, res) {
      const result = await leadsService.listLeads(req.user.id, { company: req.query.company });
      res.json(result);
    },

    async getOne(req, res) {
      const lead = await leadsService.getLead(req.user.id, req.params.id);
      res.json({ lead });
    },

    async create(req, res) {
      const lead = await leadsService.createLead(req.user.id, req.body);
      res.status(201).json({ lead });
    },

    async bulkImport(req, res) {
      const result = await leadsService.importLeads(req.user.id, req.body);
      res.status(201).json(result);
    },

    async update(req, res) {
      const lead = await leadsService.updateLead(req.user.id, req.params.id, req.body);
      res.json({ lead });
    },

    async remove(req, res) {
      const id = await leadsService.deleteLead(req.user.id, req.params.id);
      res.json({ message: 'Lead deleted', id });
    },
  };
}
