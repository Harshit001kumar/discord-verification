function createChallenge() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  return {
    question: `${a} + ${b}`,
    answer: String(a + b)
  };
}

module.exports = {
  createChallenge
};
