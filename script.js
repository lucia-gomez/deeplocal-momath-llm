const width = document.body.clientWidth;
const height = document.body.clientHeight;
const minRadius = 40;
const maxRadius = 60;

// log-odds
const LOGITS = wordList.map((x) => x.logit);

const svg = d3
  .select("#chart")
  .append("svg")
  .attr("width", width)
  .attr("height", height)
  .attr("viewBox", `0 0 ${width} ${height}`);

const bubbleGroup = svg.append("g");

const radiusScale = d3.scaleSqrt().domain([0, 1]).range([minRadius, maxRadius]);
const colorScale = d3
  .scaleSequentialPow(d3.interpolateRgb("#3ca5f5ff", "#004c87ff"))
  .exponent(0.4)
  .domain([0, 1]);

let simulation = d3
  .forceSimulation()
  .force("charge", d3.forceManyBody().strength(10))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("x", d3.forceX(width / 2).strength(0.05))
  .force("y", d3.forceY(height / 2).strength(0.25))
  .force(
    "collision",
    d3
      .forceCollide()
      .radius((d) => d.radius + 2)
      .strength(1)
  )
  .velocityDecay(0.2)
  .alphaDecay(0.03);

let previousData = [];

function update(topK, topP, temperature) {
  const probabilities = softmax(temperature);
  const maxProb = Math.max(...probabilities);

  const scaledLogits = LOGITS.map((L) => L / temperature);
  const maxLogit = Math.max(...scaledLogits);
  const exps = scaledLogits.map((L) => Math.exp(L - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);

  let wordObjects = wordList.map((x, i) => ({
    word: x.word,
    logit: x.logit,
    prob: probabilities[i],
    originalIndex: i,
  }));

  let sortedWordObjects = [...wordObjects].sort((a, b) => b.prob - a.prob);

  // top-k filtering
  let currentData = sortedWordObjects.slice(0, topK);

  // top-p filtering
  let cumulativeProb = 0;
  let topPFiltered = false;
  let finalCumulativeProb = 0;
  let filtered = [];
  const epsilon = 1e-9; // avoid floating point rounding errors

  currentData.forEach((wordData) => {
    let isFiltered = false;

    if (topPFiltered) {
      isFiltered = true;
    } else {
      cumulativeProb += wordData.prob;
      finalCumulativeProb = cumulativeProb;
      if (cumulativeProb >= topP - epsilon) {
        // this word pushed the sum over p, so it's the last one
        // any remaining words will be filtered
        topPFiltered = true;
      }
    }

    if (!isFiltered) {
      filtered.push(wordData);
    }
  });
  sliderToppSumValue.text(finalCumulativeProb.toFixed(4));
  currentData = filtered;

  currentData = currentData.map((d, i) => {
    // preserve position from previous data if word exists
    const prev = previousData.find((p) => p.word === d.word);
    return {
      word: d.word,
      probability: d.prob,
      radius: radiusScale(d.prob),
      color: colorScale(d.prob),
      x: prev ? prev.x : undefined,
      y: prev ? prev.y : undefined,
    };
  });

  // initialize positions for new bubbles
  currentData.forEach((d) => {
    if (d.x === undefined) {
      // consistent angle based on word hash
      const hash = d.word
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const angle = (hash % 360) * (Math.PI / 180);
      // larger bubbles start closer to center, smaller ones farther out
      const distance =
        ((1 - d.radius / maxRadius) * Math.min(width, height)) / 2;
      d.x = width / 2 + Math.cos(angle) * distance;
      d.y = height / 2 + Math.sin(angle) * distance;
    }
  });

  simulation.nodes(currentData);
  simulation.alpha(0.1).restart();
  // progress forward a bit to avoid jumpiness with sliders
  for (let i = 0; i < 80; i++) simulation.tick();

  const bubbles = bubbleGroup
    .selectAll(".bubble-group")
    .data(currentData, (d) => d.word);

  bubbles.exit().remove();

  const bubblesEnter = bubbles
    .enter()
    .append("g")
    .attr("class", "bubble-group")
    .attr("transform", (d) => `translate(${d.x},${d.y})`);

  bubblesEnter
    .append("circle")
    .attr("class", "bubble")
    .attr("r", (d) => d.radius);

  bubblesEnter
    .append("text")
    .attr("class", "bubble-text")
    .attr("text-anchor", "middle")
    .attr("dy", "-0.5em")
    .text((d) => d.word)
    .style("font-size", (d) => `${Math.max(8, d.radius / 3)}px`);

  bubblesEnter
    .append("text")
    .attr("class", "bubble-probability")
    // .attr("text-anchor", "middle")
    .attr("dy", "1em")
    .text((d) => `${(d.probability * 100).toFixed(2)}%`)
    .style("font-size", (d) => `${Math.max(6, d.radius / 4)}px`);

  const bubblesUpdate = bubblesEnter.merge(bubbles);

  bubblesUpdate
    .select(".bubble")
    .attr("r", (d) => d.radius)
    .style("fill", (d) => d.color);

  bubblesUpdate
    .select(".bubble-text")
    .style("font-size", (d) => `${Math.max(4, d.radius / 3)}px`);

  bubblesUpdate
    .select(".bubble-probability")
    .text((d) => `${(d.probability * 100).toFixed(2)}%`)
    .style("font-size", (d) => `${Math.max(6, d.radius / 4)}px`);

  simulation.on("tick", null);
  simulation.on("tick", () => {
    // keep bubbles within bounds
    bubblesUpdate.each(function (d) {
      d.x = Math.max(d.radius, Math.min(width - d.radius, d.x));
      d.y = Math.max(d.radius, Math.min(height - d.radius, d.y));
    });
    bubblesUpdate.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  previousData = currentData;
}

const sliderTopk = d3.select("#topK");
const sliderTopkValue = d3.select("#top-k");

const sliderTopp = d3.select("#topP");
const sliderToppValue = d3.select("#top-p");
const sliderToppSumValue = d3.select("#top-p-sum");

const sliderTemp = d3.select("#temp");
const sliderTempValue = d3.select("#temp-val");

function softmax(temperature) {
  // Ensure temperature is not zero to avoid division by zero
  const temp = Math.max(temperature, 1e-6);

  // 1. Scale logits by temperature
  const scaledLogits = LOGITS.map((L) => L / temp);

  // 2. Find max logit for numerical stability
  const maxLogit = Math.max(...scaledLogits);

  // 3. Calculate exponentials
  const exps = scaledLogits.map((L) => Math.exp(L - maxLogit));

  // 4. Sum exponentials
  const sumExps = exps.reduce((a, b) => a + b, 0);

  // 5. Normalize to get probabilities
  const probs = exps.map((e) => e / sumExps);

  return probs;
}

// throttle to avoid jumpiness
let updateTimeout;
function handleSliderInput() {
  const topK = Number(sliderTopk.property("value"));
  const topP = Number(sliderTopp.property("value"));
  const temp = Number(sliderTemp.property("value"));

  sliderTopkValue.text(topK);
  sliderToppValue.text(topP);

  const T = temp.toFixed(2);
  const formula = `\\( P(w_i) = \\class{math}{\\frac{e^{logit_i / \\class{dynamic}{${T}}}}{\\sum_{k=1}^{n} e^{logit_k / \\class{dynamic}{${T}}}}} \\)`;
  sliderTempValue.text(formula);
  // rerender the formula
  MathJax.typesetPromise();

  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    update(topK, topP, temp);
  }, 5);
}

sliderTopk.on("input", handleSliderInput);
sliderTopp.on("input", handleSliderInput);
sliderTemp.on("input", handleSliderInput);

update(50, 1.0, 0.5);
