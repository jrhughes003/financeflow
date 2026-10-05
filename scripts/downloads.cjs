#!/usr/bin/env node
//
// How many people have downloaded a release?
//
// GitHub counts this per asset but does not show it anywhere in the web UI —
// the number only exists in the REST API, which is why this script exists.
//
//   npm run downloads
//
// No token needed: the releases endpoint is public for a public repo. Set
// GITHUB_TOKEN if you hit the anonymous rate limit (60 requests an hour).
//
// What the number counts: one HTTP fetch of the asset. It is not unique
// people. A resumed download, a mirror, a CI job and a crawler each add to it,
// and GitHub does not break it down by country, referrer or date — if you want
// a trend you have to record the number yourself over time. Cloning the repo,
// viewing the release page and building from source all count zero.
//
// Page views and clone counts are a separate thing entirely, under
// Insights → Traffic on github.com (or /repos/:owner/:repo/traffic/views,
// which needs push access). Those are kept for 14 days only.

const REPO = process.env.REPO || 'jrhughes003/financeflow';

async function main() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'financeflow-downloads' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers });
  if (!res.ok) {
    console.error(`GitHub said ${res.status} ${res.statusText}`);
    if (res.status === 403) console.error('Rate limited. Set GITHUB_TOKEN to raise the limit.');
    process.exit(1);
  }
  const releases = await res.json();
  if (!releases.length) {
    console.log('No releases yet.');
    return;
  }

  let grand = 0;
  for (const r of releases) {
    // A draft is invisible to everyone but you, so it can never be downloaded.
    // Worth saying out loud: a release left as a draft looks published from
    // the inside and is a 404 from the outside.
    const state = r.draft ? '  [DRAFT — not visible to anyone else]' : r.prerelease ? '  [pre-release]' : '';
    const when = r.published_at ? new Date(r.published_at).toISOString().slice(0, 10) : 'unpublished';
    console.log(`\n${r.tag_name}  ${when}${state}`);

    const assets = r.assets.filter(a => !/\.blockmap$/.test(a.name));
    if (!assets.length) {
      console.log('   (no downloadable assets)');
      continue;
    }
    for (const a of r.assets) {
      const mb = (a.size / 1048576).toFixed(1).padStart(6);
      const n = String(a.download_count).padStart(6);
      const quiet = /\.blockmap$|^SHA256SUMS/.test(a.name) ? '  ·' : '   ';
      console.log(`  ${quiet} ${a.name.padEnd(40)} ${mb} MB   ${n} downloads`);
      if (!/\.blockmap$/.test(a.name)) grand += a.download_count;
    }
  }

  console.log(`\nTotal across all non-blockmap assets: ${grand}`);
  console.log('(A blockmap is fetched by the updater, not by a person, so it is excluded.)');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
