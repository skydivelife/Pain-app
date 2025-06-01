# Pain-app
App to work on pain issues 
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pain Assessment & Stretch Guide</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        primary: '#5D5CDE',
                        'primary-dark': '#4B4BC8'
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen transition-colors">
    <div class="container mx-auto px-4 py-8 max-w-4xl">
        <!-- Header -->
        <div class="text-center mb-8">
            <h1 class="text-3xl md:text-4xl font-bold text-primary mb-3">Pain Assessment & Stretch Guide</h1>
            <p class="text-gray-600 dark:text-gray-400 text-lg">Describe your pain to get personalized assessment questions and stretch recommendations</p>
            <div class="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                <p class="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Disclaimer:</strong> This tool provides general guidance only. Consult a healthcare professional for persistent or severe pain.
                </p>
            </div>
        </div>

        <!-- Step 1: Pain Description -->
        <div id="step1" class="mb-8">
            <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4 flex items-center">
                    <span class="bg-primary text-white rounded-full w-8 h-8 flex items-center justify-center text-sm mr-3">1</span>
                    Describe Your Pain
                </h2>
                <div class="space-y-4">
                    <div>
                        <label for="painDescription" class="block text-sm font-medium mb-2">
                            Tell us about the pain you're experiencing (location, type, when it occurs, etc.)
                        </label>
                        <textarea 
                            id="painDescription" 
                            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-base min-h-[120px] resize-vertical"
                            placeholder="Example: I have lower back pain on the right side that gets worse when I sit for long periods. It's a dull ache that sometimes shoots down my leg..."
                        ></textarea>
                    </div>
                    <button 
                        id="getAssessmentBtn"
                        class="bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center"
                    >
                        <span id="assessmentBtnText">Get Assessment Questions</span>
                        <div id="assessmentSpinner" class="hidden ml-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    </button>
                </div>
            </div>
        </div>

        <!-- Step 2: Assessment Questions -->
        <div id="step2" class="mb-8 hidden">
            <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4 flex items-center">
                    <span class="bg-primary text-white rounded-full w-8 h-8 flex items-center justify-center text-sm mr-3">2</span>
                    Assessment Questions
                </h2>
                <div id="assessmentContent" class="space-y-4">
                    <!-- Assessment questions will be populated here -->
                </div>
                <div id="assessmentAnswers" class="space-y-4 mt-6">
                    <!-- Answer inputs will be populated here -->
                </div>
                <button 
                    id="getStretchesBtn"
                    class="mt-6 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center hidden"
                >
                    <span id="stretchesBtnText">Get Stretch Recommendations</span>
                    <div id="stretchesSpinner" class="hidden ml-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                </button>
            </div>
        </div>

        <!-- Step 3: Stretch Recommendations -->
        <div id="step3" class="mb-8 hidden">
            <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                <h2 class="text-xl font-semibold mb-4 flex items-center">
                    <span class="bg-green-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm mr-3">3</span>
                    Recommended Stretches
                </h2>
                <div id="stretchesContent" class="space-y-4">
                    <!-- Stretch recommendations will be populated here -->
                </div>
            </div>
        </div>

        <!-- Error Display -->
        <div id="errorMessage" class="hidden mb-8">
            <div class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4">
                <div class="flex items-center">
                    <div class="text-red-600 dark:text-red-400 mr-3">⚠️</div>
                    <div>
                        <h3 class="font-medium text-red-800 dark:text-red-200">Error</h3>
                        <p id="errorText" class="text-red-700 dark:text-red-300 mt-1"></p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script>
        // Dark mode setup
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
            if (event.matches) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        });

        // State management
        let assessmentQuestions = [];
        let userAnswers = {};

        // UI Elements
        const painDescription = document.getElementById('painDescription');
        const getAssessmentBtn = document.getElementById('getAssessmentBtn');
        const assessmentBtnText = document.getElementById('assessmentBtnText');
        const assessmentSpinner = document.getElementById('assessmentSpinner');
        
        const step2 = document.getElementById('step2');
        const assessmentContent = document.getElementById('assessmentContent');
        const assessmentAnswers = document.getElementById('assessmentAnswers');
        const getStretchesBtn = document.getElementById('getStretchesBtn');
        const stretchesBtnText = document.getElementById('stretchesBtnText');
        const stretchesSpinner = document.getElementById('stretchesSpinner');
        
        const step3 = document.getElementById('step3');
        const stretchesContent = document.getElementById('stretchesContent');
        
        const errorMessage = document.getElementById('errorMessage');
        const errorText = document.getElementById('errorText');

        // Register handlers for Poe API
        window.Poe.registerHandler("assessment-handler", (result, context) => {
            const msg = result.responses[0];
            
            if (msg.status === "error") {
                showError("Error getting assessment questions: " + (msg.statusText || "Unknown error"));
                hideAssessmentSpinner();
            } else if (msg.status === "complete") {
                try {
                    processAssessmentQuestions(msg.content);
                    hideAssessmentSpinner();
                } catch (error) {
                    showError("Error processing assessment questions: " + error.message);
                    hideAssessmentSpinner();
                }
            }
        });

        window.Poe.registerHandler("stretches-handler", (result, context) => {
            const msg = result.responses[0];
            
            if (msg.status === "error") {
                showError("Error getting stretch recommendations: " + (msg.statusText || "Unknown error"));
                hideStretchesSpinner();
            } else if (msg.status === "complete") {
                processStretchRecommendations(msg.content);
                hideStretchesSpinner();
            }
        });

        // Event listeners
        getAssessmentBtn.addEventListener('click', async () => {
            const pain = painDescription.value.trim();
            if (!pain) {
                showError("Please describe your pain before proceeding.");
                return;
            }

            hideError();
            showAssessmentSpinner();

            const prompt = `@Claude-3.7-Sonnet You are a physical therapy assessment assistant. Based on this pain description: "${pain}"

Please provide 5-7 specific assessment questions that would help determine the best stretches and exercises. Ask about:
- Pain intensity and quality
- Specific movements that worsen/improve it
- Duration and onset
- Previous injuries or medical history
- Daily activities affected
- Any numbness, tingling, or radiating pain

Format your response as a numbered list of clear, specific questions. Provide ONLY the questions, no additional text or explanations.`;

            try {
                await window.Poe.sendUserMessage(prompt, {
                    handler: "assessment-handler",
                    stream: false,
                    openChat: false
                });
            } catch (err) {
                showError("Error sending message: " + err.message);
                hideAssessmentSpinner();
            }
        });

        getStretchesBtn.addEventListener('click', async () => {
            const answers = collectAnswers();
            if (answers.length === 0) {
                showError("Please answer all assessment questions before proceeding.");
                return;
            }

            hideError();
            showStretchesSpinner();

            const answersText = answers.map((answer, index) => 
                `Q${index + 1}: ${assessmentQuestions[index]}\nA: ${answer}`
            ).join('\n\n');

            const prompt = `@Claude-3.7-Sonnet You are a physical therapy specialist. Based on this pain assessment:

Original pain description: "${painDescription.value.trim()}"

Assessment Q&A:
${answersText}

Please provide 5-8 specific stretches and exercises that would help address this pain. For each stretch/exercise, include:
1. Clear name/title
2. Step-by-step instructions
3. Duration/repetitions
4. Important safety notes or contraindications
5. When to perform it (frequency)
6. A YouTube video link - search for and provide a direct YouTube URL (https://www.youtube.com/watch?v=...) to a reputable instructional video demonstrating the exercise properly

Format using markdown with clear headings and bullet points. For the YouTube links, use this format: **Video Demo:** [Watch on YouTube](actual_youtube_url)

Focus on evidence-based recommendations that are safe for self-administration. Include a brief explanation of why these stretches target the identified problem.`;

            try {
                await window.Poe.sendUserMessage(prompt, {
                    handler: "stretches-handler",
                    stream: false,
                    openChat: false
                });
            } catch (err) {
                showError("Error sending message: " + err.message);
                hideStretchesSpinner();
            }
        });

        // Helper functions
        function showAssessmentSpinner() {
            assessmentBtnText.textContent = "Getting Questions...";
            assessmentSpinner.classList.remove('hidden');
            getAssessmentBtn.disabled = true;
        }

        function hideAssessmentSpinner() {
            assessmentBtnText.textContent = "Get Assessment Questions";
            assessmentSpinner.classList.add('hidden');
            getAssessmentBtn.disabled = false;
        }

        function showStretchesSpinner() {
            stretchesBtnText.textContent = "Getting Stretches...";
            stretchesSpinner.classList.remove('hidden');
            getStretchesBtn.disabled = true;
        }

        function hideStretchesSpinner() {
            stretchesBtnText.textContent = "Get Stretch Recommendations";
            stretchesSpinner.classList.add('hidden');
            getStretchesBtn.disabled = false;
        }

        function showError(message) {
            errorText.textContent = message;
            errorMessage.classList.remove('hidden');
            errorMessage.scrollIntoView({ behavior: 'smooth' });
        }

        function hideError() {
            errorMessage.classList.add('hidden');
        }

        function processAssessmentQuestions(content) {
            // Parse the numbered list of questions
            const lines = content.trim().split('\n').filter(line => line.trim());
            assessmentQuestions = lines.map(line => {
                // Remove number and clean up the question
                return line.replace(/^\d+\.\s*/, '').trim();
            }).filter(q => q.length > 0);

            if (assessmentQuestions.length === 0) {
                showError("No assessment questions were generated. Please try again.");
                return;
            }

            // Display questions
            assessmentContent.innerHTML = `
                <div class="prose dark:prose-invert max-w-none">
                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Please answer the following questions to help us recommend the best stretches for your condition:</p>
                </div>
            `;

            // Create answer inputs
            assessmentAnswers.innerHTML = '';
            assessmentQuestions.forEach((question, index) => {
                const answerDiv = document.createElement('div');
                answerDiv.className = 'space-y-2';
                answerDiv.innerHTML = `
                    <label class="block text-sm font-medium">
                        ${index + 1}. ${question}
                    </label>
                    <textarea 
                        id="answer-${index}"
                        class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-base resize-vertical"
                        rows="2"
                        placeholder="Your answer..."
                    ></textarea>
                `;
                assessmentAnswers.appendChild(answerDiv);
            });

            // Show step 2 and the get stretches button
            step2.classList.remove('hidden');
            getStretchesBtn.classList.remove('hidden');
            step2.scrollIntoView({ behavior: 'smooth' });
        }

        function collectAnswers() {
            const answers = [];
            for (let i = 0; i < assessmentQuestions.length; i++) {
                const answerInput = document.getElementById(`answer-${i}`);
                const answer = answerInput ? answerInput.value.trim() : '';
                if (!answer) {
                    return []; // Return empty if any question is unanswered
                }
                answers.push(answer);
            }
            return answers;
        }

        function processStretchRecommendations(content) {
            // Display the markdown content
            const markdownHtml = marked.parse(content);
            
            // Enhance YouTube links with better styling
            const enhancedHtml = markdownHtml.replace(
                /(<a[^>]*href="https:\/\/www\.youtube\.com[^"]*"[^>]*>.*?<\/a>)/gi,
                '<span class="inline-flex items-center mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"><svg class="w-5 h-5 text-red-600 dark:text-red-400 mr-2" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136C4.495 20.455 12 20.455 12 20.455s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>$1</span>'
            );
            
            stretchesContent.innerHTML = `
                <div class="prose dark:prose-invert max-w-none">
                    ${enhancedHtml}
                </div>
            `;

            // Show step 3
            step3.classList.remove('hidden');
            step3.scrollIntoView({ behavior: 'smooth' });
        }
    </script>
</body>
</html>