#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const repositoryName = process.env.GITHUB_REPOSITORY ?? 'zluckyhou/longshot';
const outputPath = process.env.STAR_HISTORY_OUTPUT ?? 'docs/star-history.svg';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function coordinate(value, inputMin, inputMax, outputMin, outputMax) {
  if (inputMax === inputMin) return outputMin;
  return outputMin + ((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin);
}

async function fetchStarHistory(repository, token) {
  const [owner, name] = repository.split('/');
  if (!owner || !name || repository.split('/').length !== 2) {
    throw new Error(`Expected GITHUB_REPOSITORY in owner/name form, received: ${repository}`);
  }
  if (!token) throw new Error('GITHUB_TOKEN is required to fetch star history');

  const query = `
    query StarHistory($owner: String!, $name: String!, $after: String) {
      repository(owner: $owner, name: $name) {
        createdAt
        stargazers(
          first: 100
          after: $after
          orderBy: { field: STARRED_AT, direction: ASC }
        ) {
          edges { starredAt }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  let after = null;
  let createdAt = null;
  const starredAt = [];

  do {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({ query, variables: { owner, name, after } }),
    });

    if (!response.ok) {
      throw new Error(`GitHub GraphQL request failed with ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(`GitHub GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
    }

    const repositoryData = payload.data?.repository;
    if (!repositoryData) throw new Error(`Repository not found: ${repository}`);

    createdAt ??= repositoryData.createdAt;
    starredAt.push(...repositoryData.stargazers.edges.map((edge) => edge.starredAt));
    after = repositoryData.stargazers.pageInfo.hasNextPage
      ? repositoryData.stargazers.pageInfo.endCursor
      : null;
  } while (after);

  return { createdAt, starredAt };
}

function renderChart(repository, createdAt, starredAt) {
  const width = 960;
  const height = 480;
  const margin = { top: 94, right: 48, bottom: 64, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) throw new Error(`Invalid repository creation date: ${createdAt}`);

  const starTimes = starredAt.map((value) => new Date(value).getTime()).sort((a, b) => a - b);
  if (starTimes.some((value) => !Number.isFinite(value))) throw new Error('Star history contains an invalid date');

  const lastEvent = starTimes.at(-1) ?? start;
  const end = Math.max(start + DAY_MS, lastEvent + DAY_MS);
  const yMax = Math.max(1, starTimes.length);
  const x = (value) => coordinate(value, start, end, margin.left, margin.left + plotWidth);
  const y = (value) => coordinate(value, 0, yMax, margin.top + plotHeight, margin.top);

  const points = [[x(start), y(0)]];
  starTimes.forEach((timestamp, index) => {
    points.push([x(timestamp), y(index)]);
    points.push([x(timestamp), y(index + 1)]);
  });
  points.push([x(end), y(starTimes.length)]);

  const linePath = points.map(([px, py], index) => `${index ? 'L' : 'M'} ${px.toFixed(2)} ${py.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${x(end).toFixed(2)} ${y(0).toFixed(2)} Z`;

  const yTicks = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round((yMax * index) / 4)))];
  const xTicks = [start, start + (end - start) / 2, end];

  const grid = yTicks.map((tick) => `
    <line class="grid" x1="${margin.left}" y1="${y(tick).toFixed(2)}" x2="${margin.left + plotWidth}" y2="${y(tick).toFixed(2)}"/>
    <text class="axis" x="${margin.left - 14}" y="${(y(tick) + 5).toFixed(2)}" text-anchor="end">${tick}</text>`).join('');

  const labels = xTicks.map((tick, index) => `
    <text class="axis" x="${x(tick).toFixed(2)}" y="${height - 28}" text-anchor="${index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}">${formatDate(tick)}</text>`).join('');

  const subtitle = starTimes.length === 0
    ? 'Waiting for the first star'
    : `${starTimes.length} star${starTimes.length === 1 ? '' : 's'}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">Star history for ${escapeXml(repository)}</title>
  <desc id="description">Cumulative GitHub stars over time. ${escapeXml(subtitle)}.</desc>
  <style>
    .background { fill: #ffffff; }
    .title { fill: #1f2328; font: 700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .subtitle, .axis { fill: #59636e; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .grid { stroke: #d0d7de; stroke-width: 1; }
    .area { fill: #ff4f00; opacity: 0.12; }
    .line { fill: none; stroke: #ff4f00; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; }
      .title { fill: #f0f6fc; }
      .subtitle, .axis { fill: #8b949e; }
      .grid { stroke: #30363d; }
    }
  </style>
  <rect class="background" width="${width}" height="${height}" rx="16"/>
  <text class="title" x="${margin.left}" y="42">GitHub Star History</text>
  <text class="subtitle" x="${margin.left}" y="68">${escapeXml(repository)} · ${escapeXml(subtitle)}</text>
${grid}
${labels}
  <path class="area" d="${areaPath}"/>
  <path class="line" d="${linePath}"/>
</svg>
`;
}

const emptyMode = process.argv.includes('--empty');
const history = emptyMode
  ? {
      createdAt: process.env.REPOSITORY_CREATED_AT ?? '2026-08-21T11:31:24Z',
      starredAt: [],
    }
  : await fetchStarHistory(repositoryName, process.env.GITHUB_TOKEN);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderChart(repositoryName, history.createdAt, history.starredAt), 'utf8');
console.log(`Wrote ${outputPath} with ${history.starredAt.length} star event(s)`);
