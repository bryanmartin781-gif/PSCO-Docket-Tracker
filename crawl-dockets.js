const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOCKETS = process.env.DOCKETS.split(',');

async function crawlDocket(docketId) {
  const url = `https://www.dora.state.co.us/pls/efi/EFI.Show_Docket?p_docket_id=${docketId}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PSCO-Docket-Tracker/1.0 (Educational; github.com/[your-repo])'
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

async function main() {
  let allFilings = [];
  
  // Load existing filings
  if (fs.existsSync('filings.json')) {
    allFilings = JSON.parse(fs.readFileSync('filings.json', 'utf8'));
  }
  
  // Crawl each docket
  for (const docketId of DOCKETS) {
    console.log(`Crawling ${docketId}...`);
    const newFilings = await crawlDocket(docketId);
    
    newFilings.forEach(filing => {
      const exists = allFilings.find(f => 
        f.docketId === filing.docketId && 
        f.title === filing.title
      );
      if (!exists) {
        allFilings.push(filing);
        console.log(`  NEW: ${filing.title}`);
      }
    });
    
    // Rate limiting: 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Save to JSON
  fs.writeFileSync('filings.json', JSON.stringify(allFilings, null, 2));
  
  // Generate markdown summary
  const summary = generateSummary(allFilings);
  fs.writeFileSync('LATEST_FILINGS.md', summary);
  
  console.log(`Total filings tracked: ${allFilings.length}`);
}

function generateSummary(filings) {
  const byDocket = {};
  filings.forEach(f => {
    if (!byDocket[f.docketId]) byDocket[f.docketId] = [];
    byDocket[f.docketId].push(f);
  });
  
  let md = `# PSCO Docket Tracker\n\nLast updated: ${new Date().toISOString()}\n\n`;
  
  for (const [docketId, docketFilings] of Object.entries(byDocket)) {
    md += `## ${docketId}\n\n`;
    docketFilings.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).forEach(f => {
      md += `- **${f.date}** | ${f.title} | *${f.submitter}*\n`;
    });
    md += '\n';
  }
  
  return md;
}

main().catch(console.error);
