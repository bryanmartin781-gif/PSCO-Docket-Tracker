import * as cheerio from 'cheerio';
import fs from 'fs';

const DOCKETS = process.env.DOCKETS.split(',');

// Document types to exclude entirely — procedural noise that isn't useful signal.
// Matched against the "Document Type(s)" column DORA provides (more reliable than title text).
const EXCLUDE_DOC_TYPES = [
  'non-disclosure agreement',   // covers "Non-Disclosure Agreement" and "(Highly)" variants
  'entry of appearance',
  'withdrawal'
];

function isExcludedDocType(docType) {
  const t = docType.toLowerCase();
  return EXCLUDE_DOC_TYPES.some(excluded => t.includes(excluded));
}

// SABESS risk keywords and implications
const SABESS_KEYWORDS = {
  'load forecast': { risk: 'CRITICAL', category: 'Procurement', impact: 'Load forecast changes affect procurement volumes and SABESS viability. Higher forecast = more storage need.' },
  'transmission': { risk: 'HIGH', category: 'Infrastructure', impact: 'Transmission constraints in northern pocket (Fort Lupton) affect interconnection timing and headroom.' },
  'fort lupton': { risk: 'CRITICAL', category: 'Site-Specific', impact: 'Direct mention of your project location. Monitor interconnection, headroom, and grid support.' },
  'arroyo 2': { risk: 'HIGH', category: 'Precedent', impact: 'Arroyo 2 BESS is your direct precedent. Track interconnection approach, provisional service, timeline.' },
  'storage': { risk: 'MEDIUM', category: 'Market', impact: 'Storage procurement volumes and bid economics shape competitive landscape.' },
  'phase ii rfp': { risk: 'CRITICAL', category: 'Procurement', impact: 'JTS Phase II RFP is primary vehicle for SABESS deployment. RFP timing and scope are make-or-break.' },
  'bid 118': { risk: 'MEDIUM', category: 'Competitive', impact: 'Standalone 400 MW storage bid. If deferred, improves SABESS positioning vs. competing storage.' },
  'bid 094': { risk: 'MEDIUM', category: 'Competitive', impact: 'Company self-build 450 MW solar+storage. Direct competitor in Phase II and similar timeline.' },
  'bid 127': { risk: 'MEDIUM', category: 'Competitive', impact: 'Deferred 608 MW wind bid. Re-approval affects RFP competition and Phase II resource mix.' },
  'comanche': { risk: 'MEDIUM', category: 'Timeline', impact: 'Comanche 3 repair timeline affects near-term capacity need and JTS Phase II urgency.' },
  'cost': { risk: 'MEDIUM', category: 'Economics', impact: 'Generic cost changes (capital, O&M) affect SABESS cost competitiveness in RFP evaluation.' },
  'interconnection': { risk: 'HIGH', category: 'Site-Specific', impact: 'Interconnection studies, provisional service, or headroom constraints directly impact Fort Lupton SABESS.' },
  'elcc': { risk: 'MEDIUM', category: 'Technical', impact: 'ELCC curves determine storage accreditation. Storage over-accreditation was corrected in April 2026 filing.' },
  'just transition': { risk: 'LOW', category: 'Policy', impact: 'Fort Lupton not a JT community (Pueblo, Morgan County are). Less relevant but monitor for scope changes.' },
  'rate case': { risk: 'MEDIUM', category: 'Economics', impact: 'Rate case decisions on battery cost recovery and incentives affect SABESS project economics.' },
  'curtailment': { risk: 'MEDIUM', category: 'Operations', impact: 'High curtailment of renewables increases storage value for energy shifting and grid support.' },
  'pvrr': { risk: 'MEDIUM', category: 'Economics', impact: 'Present Value Revenue Requirement changes affect cost-benefit analysis for SABESS vs. alternatives.' }
};

// Titles matching these rules are force-escalated to at least the given risk level,
// regardless of what keyword matching alone would produce.
const RISK_ESCALATION_RULES = [
  {
    test: (title) => /^C\d{2}-\d+/i.test(title.trim()) || /commission decision/i.test(title),
    minRisk: 'HIGH',
    keyword: 'commission decision',
    category: 'Regulatory',
    impact: 'Commission decisions can directly affect SABESS approval pathways, timelines, and regulatory precedent.'
  },
  {
    test: (title) => /supplemental modeling informational filing/i.test(title),
    minRisk: 'HIGH',
    keyword: 'supplemental modeling',
    category: 'Technical',
    impact: 'Supplemental modeling filings can reveal updated assumptions affecting SABESS economics and resource need.'
  }
];

const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// Static background context — not tied to any single filing, just standing
// notes to keep in view each cycle. Edit this array directly to add/update notes.
const PROJECT_CONTEXT = [
  {
    docketId: '24A-0442E',
    note: 'JTS Phase II RFP: Following the Commission\'s approval of the Phase 1 methodologies in late 2025, Xcel launched Phase II in early 2026. They are actively soliciting new power generation bids from developers to replace the retiring Comanche and Craig coal units.'
  },
  {
    docketId: '24A-0547E',
    note: '2025-2029 Distribution System Plan: Initiated in December 2024, PSCo is seeking approval for approximately $4.9 billion in capital spending over five years to modernize the grid, expand capacity, and evaluate non-wires alternatives.'
  }
];

async function crawlDocket(docketId) {
  const url = `https://www.dora.state.co.us/pls/efi/EFI.Show_Docket?p_session_id=&p_docket_id=${docketId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PSCO-Docket-Tracker/1.0 (Educational; github.com/your-repo)'
      }
    });

    console.log(`[DEBUG] ${docketId} - HTTP status: ${response.status}`);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    // Auto-extract the proceeding's official name from the page itself, so we
    // never have to hardcode/maintain a docket-name lookup table manually.
    const pageText = $('body').text().replace(/\s+/g, ' ').trim();
    const nameMatch = pageText.match(/Proceeding Name:\s*(.+?)\s*Open Date:/);
    const proceedingName = nameMatch ? nameMatch[1].trim() : 'Unknown Proceeding';

    const daysBack = parseInt(process.env.DAYS_BACK || '180', 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const filings = [];
    let skippedOld = 0;
    let skippedExcluded = 0;

    // DORA nests tables for layout, so .children('td') (not .find('td')) keeps us
    // scoped to only this row's own cells, not cells from nested tables.
    // Columns are: Title | Submitted | Document Type(s) | Filing Party | Confidentiality
    $('tr').each((i, elem) => {
      const cells = $(elem).children('td');
      if (cells.length >= 5) {
        const title = $(cells[0]).text().trim();
        const date = $(cells[1]).text().trim();
        const docType = $(cells[2]).text().trim();
        const submitter = $(cells[3]).text().trim();
        const confidentiality = $(cells[4]).text().trim();

        const dateMatch = date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!title || !dateMatch) return;

        const [, month, day, year] = dateMatch;
        const parsedDate = new Date(`${year}-${month}-${day}`);

        if (parsedDate < cutoff) {
          skippedOld++;
          return;
        }

        if (isExcludedDocType(docType)) {
          skippedExcluded++;
          return;
        }

        filings.push({
          date,
          parsedDate: parsedDate.toISOString(),
          title,
          docType,
          submitter,
          confidentiality,
          docketId,
          proceedingName,
          fetchedAt: new Date().toISOString()
        });
      }
    });

    console.log(`[DEBUG] ${docketId} - "${proceedingName}" - Parsed ${filings.length} filing(s) within last ${daysBack} days (skipped ${skippedOld} older, ${skippedExcluded} excluded doc types)`);

    return { filings, proceedingName };
  } catch (error) {
    console.error(`Error crawling ${docketId}:`, error.message);
    return { filings: [], proceedingName: 'Unknown Proceeding' };
  }
}

function analyzeSABESS(filing) {
  const text = filing.title.toLowerCase(); // title only — submitter names (e.g. orgs with "Storage" in their name) caused false positives
  const implications = [];

  for (const [keyword, rule] of Object.entries(SABESS_KEYWORDS)) {
    if (text.includes(keyword)) {
      implications.push({
        keyword,
        risk: rule.risk,
        category: rule.category,
        impact: rule.impact
      });
    }
  }

  // Apply forced escalation rules (e.g. Commission Decisions, Supplemental Modeling filings)
  for (const rule of RISK_ESCALATION_RULES) {
    if (rule.test(filing.title)) {
      implications.push({
        keyword: rule.keyword,
        risk: rule.minRisk,
        category: rule.category,
        impact: rule.impact
      });
    }
  }

  const riskLevel = implications.length > 0
    ? implications.reduce((highest, impl) =>
        RISK_ORDER[impl.risk] > RISK_ORDER[highest] ? impl.risk : highest, 'LOW')
    : 'LOW';

  return {
    isSABESSRelevant: implications.length > 0,
    riskLevel,
    implications
  };
}

async function main() {
  let allFilings = [];

  if (fs.existsSync('filings.json')) {
    allFilings = JSON.parse(fs.readFileSync('filings.json', 'utf8'));
  }

  const newFilingsList = [];
  const docketNames = {};

  for (const docketId of DOCKETS) {
    console.log(`Crawling ${docketId}...`);
    const { filings: crawledFilings, proceedingName } = await crawlDocket(docketId);
    docketNames[docketId] = proceedingName;

    crawledFilings.forEach(filing => {
      const exists = allFilings.find(f =>
        f.docketId === filing.docketId &&
        f.title === filing.title &&
        f.date === filing.date
      );

      if (!exists) {
        const analysis = analyzeSABESS(filing);
        filing.sabess = analysis;

        allFilings.push(filing);
        newFilingsList.push(filing);

        console.log(`  NEW: ${filing.title} [${analysis.riskLevel}]`);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  fs.writeFileSync('filings.json', JSON.stringify(allFilings, null, 2));
  fs.writeFileSync('docket-names.json', JSON.stringify(docketNames, null, 2));

  const summary = generateSummary(allFilings, newFilingsList, docketNames);
  fs.writeFileSync('LATEST_FILINGS.md', summary);

  const sabessReport = generateSABESSReport(newFilingsList, docketNames);
  fs.writeFileSync('SABESS_IMPLICATIONS.md', sabessReport);

  console.log(`Total filings tracked: ${allFilings.length}`);
  console.log(`New filings this cycle: ${newFilingsList.length}`);
  console.log(`SABESS-relevant filings: ${newFilingsList.filter(f => f.sabess.isSABESSRelevant).length}`);
}

function generateSummary(filings, newFilings, docketNames) {
  const byDocket = {};
  filings.forEach(f => {
    if (!byDocket[f.docketId]) byDocket[f.docketId] = [];
    byDocket[f.docketId].push(f);
  });

  let md = `# PSCO Docket Tracker\n\nLast updated: ${new Date().toISOString()}\n`;
  md += `New filings this cycle: ${newFilings.length} | SABESS-relevant: ${newFilings.filter(f => f.sabess?.isSABESSRelevant).length}\n\n`;

  if (PROJECT_CONTEXT.length > 0) {
    md += `## Background Context\n\n`;
    PROJECT_CONTEXT.forEach(ctx => {
      const url = `https://www.dora.state.co.us/pls/efi/EFI.Show_Docket?p_session_id=&p_docket_id=${ctx.docketId}`;
      md += `- **[${ctx.docketId}](${url})**: ${ctx.note}\n`;
    });
    md += '\n';
  }

  for (const [docketId, docketFilings] of Object.entries(byDocket)) {
    const name = docketNames[docketId] || docketFilings[0]?.proceedingName || 'Unknown Proceeding';
    const url = `https://www.dora.state.co.us/pls/efi/EFI.Show_Docket?p_session_id=&p_docket_id=${docketId}`;
    md += `## [${docketId}](${url}): ${name}\n\n`;
    docketFilings.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(f => {
      const sabessFlag = f.sabess?.isSABESSRelevant ? ` ⚡ [${f.sabess.riskLevel}]` : '';
      md += `- **${f.date}** | ${f.title} | *${f.submitter}*${sabessFlag}\n`;
    });
    md += '\n';
  }

  return md;
}

function generateSABESSReport(newFilings, docketNames) {
  const sabessFilings = newFilings.filter(f => f.sabess.isSABESSRelevant);

  if (sabessFilings.length === 0) {
    return `# SABESS Implications Report\n\nLast updated: ${new Date().toISOString()}\n\n**No SABESS-relevant filings this cycle.**\n`;
  }

  let md = `# SABESS Implications Report\n\nLast updated: ${new Date().toISOString()}\n\n`;
  md += `Found ${sabessFilings.length} SABESS-relevant filing(s) this cycle.\n\n`;

  const byRisk = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  sabessFilings.forEach(f => {
    byRisk[f.sabess.riskLevel].push(f);
  });

  for (const riskLevel of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    if (byRisk[riskLevel].length > 0) {
      md += `## ${riskLevel} Risk (${byRisk[riskLevel].length})\n\n`;

      byRisk[riskLevel].forEach(filing => {
        const name = docketNames[filing.docketId] || filing.proceedingName || 'Unknown Proceeding';
        md += `### ${filing.title}\n`;
        md += `- **Docket:** ${filing.docketId}: ${name}\n`;
        md += `- **Date:** ${filing.date}\n`;
        md += `- **Submitter:** ${filing.submitter}\n`;
        md += `- **Implications:**\n`;

        filing.sabess.implications.forEach(impl => {
          md += `  - **${impl.keyword}** [${impl.risk}]: ${impl.impact}\n`;
        });

        md += '\n';
      });
    }
  }

  md += `## Risk Categories This Cycle\n\n`;
  const categoryCount = {};
  sabessFilings.forEach(f => {
    f.sabess.implications.forEach(impl => {
      categoryCount[impl.category] = (categoryCount[impl.category] || 0) + 1;
    });
  });

  Object.entries(categoryCount).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    md += `- ${cat}: ${count} mention(s)\n`;
  });

  return md;
}

main().catch(console.error);
