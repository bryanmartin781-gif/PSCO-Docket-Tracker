const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOCKETS = process.env.DOCKETS.split(',');

// SABESS risk keywords and implications
const SABESS_KEYWORDS = {
  'load forecast': { risk: 'HIGH', category: 'Procurement', impact: 'Load forecast changes affect procurement volumes and SABESS viability. Higher forecast = more storage need.' },
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

async function crawlDocket(docketId) {
  const url = `https://www.dora.state.co.us/pls/efi/EFI.Show_Docket?p_docket_id=${docketId}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PSCO-Docket-Tracker/1.0 (Educational; github.com/your-repo)'
      }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Parse the filing table
    const filings = [];
    $('table tr').each((i, elem) => {
      const cells = $(elem).find('td');
      if (cells.length >= 3) {
        const date = $(cells[0]).text().trim();
        const title = $(cells[1]).text().trim();
        const submitter = $(cells[2]).text().trim();
        
        if (date && title) {
          filings.push({ date, title, submitter, docketId, fetchedAt: new Date().toISOString() });
        }
      }
    });
    
    return filings;
  } catch (error) {
    console.error(`Error crawling ${docketId}:`, error.message);
    return [];
  }
}

function analyzeSABESS(filing) {
  const text = (filing.title + ' ' + filing.submitter).toLowerCase();
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
  
  return {
    isSABESSRelevant: implications.length > 0,
    riskLevel: implications.length > 0 ? 
      (implications.some(i => i.risk === 'CRITICAL') ? 'CRITICAL' : 
       implications.some(i => i.risk === 'HIGH') ? 'HIGH' : 'MEDIUM') : 'LOW',
    implications
  };
}

async function main() {
  let allFilings = [];
  
  // Load existing filings
  if (fs.existsSync('filings.json')) {
    allFilings = JSON.parse(fs.readFileSync('filings.json', 'utf8'));
  }
  
  const newFilingsList = [];
  
  // Crawl each docket
  for (const docketId of DOCKETS) {
    console.log(`Crawling ${docketId}...`);
    const crawledFilings = await crawlDocket(docketId);
    
    crawledFilings.forEach(filing => {
      const exists = allFilings.find(f => 
        f.docketId === filing.docketId && 
        f.title === filing.title
      );
      
      if (!exists) {
        // Analyze new filing for SABESS implications
        const analysis = analyzeSABESS(filing);
        filing.sabess = analysis;
        
        allFilings.push(filing);
        newFilingsList.push(filing);
        
        console.log(`  NEW: ${filing.title} [${analysis.riskLevel}]`);
      }
    });
    
    // Rate limiting: 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Save to JSON
  fs.writeFileSync('filings.json', JSON.stringify(allFilings, null, 2));
  
  // Generate markdown summary with SABESS analysis
  const summary = generateSummary(allFilings, newFilingsList);
  fs.writeFileSync('LATEST_FILINGS.md', summary);
  
  // Generate SABESS-specific report
  const sabessReport = generateSABESSReport(newFilingsList);
  fs.writeFileSync('SABESS_IMPLICATIONS.md', sabessReport);
  
  console.log(`Total filings tracked: ${allFilings.length}`);
  console.log(`New filings this cycle: ${newFilingsList.length}`);
  console.log(`SABESS-relevant filings: ${newFilingsList.filter(f => f.sabess.isSABESSRelevant).length}`);
}

function generateSummary(filings, newFilings) {
  const byDocket = {};
  filings.forEach(f => {
    if (!byDocket[f.docketId]) byDocket[f.docketId] = [];
    byDocket[f.docketId].push(f);
  });
  
  let md = `# PSCO Docket Tracker\n\nLast updated: ${new Date().toISOString()}\n`;
  md += `New filings this cycle: ${newFilings.length} | SABESS-relevant: ${newFilings.filter(f => f.sabess?.isSABESSRelevant).length}\n\n`;
  
  for (const [docketId, docketFilings] of Object.entries(byDocket)) {
    md += `## ${docketId}\n\n`;
    docketFilings.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(f => {
      const sabessFlag = f.sabess?.isSABESSRelevant ? ` ⚡ [${f.sabess.riskLevel}]` : '';
      md += `- **${f.date}** | ${f.title} | *${f.submitter}*${sabessFlag}\n`;
    });
    md += '\n';
  }
  
  return md;
}

function generateSABESSReport(newFilings) {
  const sabessFilings = newFilings.filter(f => f.sabess.isSABESSRelevant);
  
  if (sabessFilings.length === 0) {
    return `# SABESS Implications Report\n\nLast updated: ${new Date().toISOString()}\n\n**No SABESS-relevant filings this cycle.**\n`;
  }
  
  let md = `# SABESS Implications Report\n\nLast updated: ${new Date().toISOString()}\n\n`;
  md += `Found ${sabessFilings.length} SABESS-relevant filing(s) this cycle.\n\n`;
  
  // Group by risk level
  const byRisk = { CRITICAL: [], HIGH: [], MEDIUM: [] };
  sabessFilings.forEach(f => {
    byRisk[f.sabess.riskLevel].push(f);
  });
  
  for (const riskLevel of ['CRITICAL', 'HIGH', 'MEDIUM']) {
    if (byRisk[riskLevel].length > 0) {
      md += `## ${riskLevel} Risk (${byRisk[riskLevel].length})\n\n`;
      
      byRisk[riskLevel].forEach(filing => {
        md += `### ${filing.title}\n`;
        md += `- **Docket:** ${filing.docketId}\n`;
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
  
  // Summary of risk categories mentioned
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
