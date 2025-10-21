"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InfoPanel from "@/components/InfoPanel";
import Editor from "@/components/Editor";
import TranscriptPanel from "@/components/TranscriptPanel";
import { Button } from "@/components/ui/button";
import { useVapi } from "@/components/VapiProvider";
import { useDebounce } from "@/hooks/useDebounce";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Monitor,
} from "lucide-react";
import { useTheme } from "next-themes";

interface LeetCodeProblem {
  title: string;
  type: string;
  description: string;
  example_test_case?: {
    input: string;
    output: string;
    explanation: string;
  };
  details?: {
    examples: Array<{
      input: string;
      output: string;
      explanation: string;
    }>;
    constraints: string[];
  };
  expected_solution?: string;
  starter_code?: string;
  starter_codes?: {
    python?: string;
    javascript?: string;
    java?: string;
    cpp?: string;
    go?: string;
    rust?: string;
  };
  solutions?: Array<{
    approach: string;
    code: string;
    time_complexity: string;
    space_complexity: string;
  }>;
  difficulty?: string;
  tags?: string[];
}

const languages = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
];

function InterviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    startCall,
    endCall,
    isCallActive,
    isSpeaking,
    sendCodeContext,
    sendProblemContext,
    transcript,
    error: vapiError,
  } = useVapi();
  
  // Get API URL from environment variable
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://harvardapi.codestacx.com";
  
  const [problemData, setProblemData] = useState<LeetCodeProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeInSeconds, setTimeInSeconds] = useState(45 * 60);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [language, setLanguage] = useState("python");
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [isEndingInterview, setIsEndingInterview] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const callInitializedRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Code editor state
  const [editorCode, setEditorCode] = useState<string>("");
  const debouncedCode = useDebounce(editorCode, 2000); // 2-second debounce
  const lastSentCodeRef = useRef<string>("");
  const hasInitialCodeBeenSent = useRef(false);

  // Get problemId from URL if present
  const problemId = searchParams.get("problemId");

  // Convert Vapi transcript to TranscriptPanel format
  const transcriptMessages = transcript
    .filter((segment) => segment.type === "transcript" && segment.text)
    .map((segment) => ({
      speaker:
        segment.role === "assistant"
          ? ("interviewer" as const)
          : ("user" as const),
      timestamp: new Date(segment.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      text: segment.text || "",
    }));

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const userAgent = navigator.userAgent.toLowerCase();
      const isMobileDevice =
        /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(
          userAgent,
        );
      const isSmallScreen = width < 1024; // Less than lg breakpoint

      setIsMobile(isMobileDevice || isSmallScreen);
      setIsChecking(false);
    };

    checkMobile();
    setMounted(true);

    // Add resize listener to detect if user resizes window
    const handleResize = () => checkMobile();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isMobile) return; // Don't fetch if on mobile

    const fetchProblem = async () => {
      try {
        setLoading(true);
        
        let data: LeetCodeProblem;
        
        if (problemId) {
          // Fetch specific problem by ID
          console.log("🔍 Fetching problem by ID:", problemId);
          const response = await fetch(
            `${API_URL}/api/problem/${problemId}`,
          );
          if (!response.ok) {
            throw new Error("Failed to fetch problem");
          }
          const problemResponse = await response.json();
          
          // Transform backend format to match frontend expectations
          data = {
            title: problemResponse.title,
            type: problemResponse.tags?.[0] || "general",
            description: problemResponse.description,
            difficulty: problemResponse.difficulty,
            details: problemResponse.details,
            starter_code: problemResponse.starter_codes?.python || "",
            starter_codes: problemResponse.starter_codes,
            tags: problemResponse.tags,
          };
          
          // Add example_test_case from details if exists
          if (problemResponse.details?.examples?.[0]) {
            data.example_test_case = problemResponse.details.examples[0];
          }
        } else {
          // Fetch random problem (existing behavior)
          console.log("🎲 Fetching random problem");
          const response = await fetch(
            `${API_URL}/api/leetcode`,
          );
          if (!response.ok) {
            throw new Error("Failed to fetch problem");
          }
          data = await response.json();
        }
        
        setProblemData(data);
        setError(null);
        console.log("✅ Problem loaded:", data.title);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
        console.error("Error fetching problem:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProblem();
  }, [isMobile, problemId, API_URL]);

  // Effect: Send problem context to Oscar when call starts
  useEffect(() => {
    if (isCallActive && problemData) {
      // Wait 500ms for call to establish, then send problem context
      setTimeout(() => {
        console.log("📋 Sending problem context to Oscar");
        sendProblemContext({
          title: problemData.title,
          difficulty: problemData.difficulty,
          description: problemData.description,
          example_test_case: problemData.example_test_case || problemData.details?.examples?.[0],
        });
      }, 500);
    }
  }, [isCallActive, problemData, sendProblemContext]);

  // Effect: Send initial starter code when call starts
  useEffect(() => {
    if (isCallActive && problemData && !hasInitialCodeBeenSent.current) {
      // Wait 1 second for call to fully establish
      setTimeout(() => {
        console.log("📤 Sending initial starter code");
        const starterCode = problemData.starter_code || "";
        sendCodeContext(starterCode, language, problemData.title);
        lastSentCodeRef.current = starterCode;
        hasInitialCodeBeenSent.current = true;
      }, 1000);
    }
  }, [isCallActive, problemData, language, sendCodeContext]);

  // Effect: Send code updates when user stops typing (debounced)
  useEffect(() => {
    if (!isCallActive || !problemData || !debouncedCode) return;

    // Don't send if assistant is speaking or code hasn't changed
    if (isSpeaking || debouncedCode === lastSentCodeRef.current) {
      return;
    }

    console.log("📤 Sending code update (typing paused)");
    sendCodeContext(debouncedCode, language, problemData.title);
    lastSentCodeRef.current = debouncedCode;
  }, [
    debouncedCode,
    isCallActive,
    isSpeaking,
    problemData,
    language,
    sendCodeContext,
  ]);

  // Start Vapi call when component mounts
  useEffect(() => {
    if (isMobile) return; // Don't start call if on mobile

    const initCall = async () => {
      if (callInitializedRef.current) return;
      if (!problemData) return;

      try {
        callInitializedRef.current = true;
        
        // Format problem data for Vapi
        const problemMetadata = {
          problemTitle: problemData.title,
          problemType: problemData.type,
          problemDifficulty: problemData.difficulty || 'Unknown',
          problemDescription: problemData.description,
          language: language,
          // Include example if available
          ...(problemData.example_test_case && {
            exampleInput: problemData.example_test_case.input,
            exampleOutput: problemData.example_test_case.output,
            exampleExplanation: problemData.example_test_case.explanation,
          }),
        };
        
        console.log("🚀 Starting call with problem metadata:", problemMetadata.problemTitle);
        
        await startCall(problemMetadata);
      } catch (err) {
        console.error("Failed to start interview call:", err);
        callInitializedRef.current = false;
      }
    };
    initCall();

    return () => {
      if (isCallActive) {
        endCall();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemData, isMobile]);

  useEffect(() => {
    if (isMobile) return; // Don't run timer if on mobile

    const timer = setInterval(() => {
      setTimeInSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isMobile]);

  const formatTime = (seconds: number) => {
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const mins = Math.floor(absSeconds / 60);
    const secs = absSeconds % 60;
    return `${isNegative ? "+" : ""}${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCodeChange = (value: string | undefined) => {
    const currentCode = value || "";
    setEditorCode(currentCode);
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const handleEndInterviewClick = () => {
    setShowEndConfirmation(true);
  };

  const handleConfirmEndInterview = async () => {
    setIsEndingInterview(true);
    setShowEndConfirmation(false);

    try {
      if (isCallActive) {
        await endCall();
      }
      router.push("/scores");
    } catch (err) {
      console.error("Error ending interview:", err);
      setIsEndingInterview(false);
    }
  };

  const handleCancelEndInterview = () => {
    setShowEndConfirmation(false);
  };

  // Show loading state while checking if mobile
  if (isChecking) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Mobile warning screen
  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Monitor className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Desktop Required</h1>
            <p className="text-muted-foreground">
              The interview practice environment requires a desktop or laptop
              computer with a larger screen.
            </p>
          </div>

          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Please access this page from a computer to practice your coding
              interviews with voice.
            </p>

            <Button
              onClick={() => router.push("/")}
              size="lg"
              className="w-full sm:w-auto"
            >
              Back to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Regular desktop interface
  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <div className="flex w-full">
        <div
          className={`${leftCollapsed ? "w-12" : "w-[420px]"} transition-all duration-300 border-r border-border/50 flex flex-col bg-muted/5 flex-shrink-0`}
        >
          {leftCollapsed ? (
            <button
              onClick={() => setLeftCollapsed(false)}
              className="h-full w-full flex items-center justify-center hover:bg-muted/30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              <div className="h-14 flex items-center justify-between px-6 border-b border-border/50">
                <h2 className="text-sm font-medium">Problem</h2>
                <button
                  onClick={() => setLeftCollapsed(true)}
                  className="p-1 hover:bg-muted rounded-md transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
              <InfoPanel
                title={problemData?.title}
                type={problemData?.type}
                description={problemData?.description}
                exampleTestCase={problemData?.example_test_case}
                details={problemData?.details}
                difficulty={problemData?.difficulty}
                tags={problemData?.tags}
                loading={loading}
                error={error}
              />
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-14 flex items-center justify-between px-6 border-b border-border/50">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium">Code</h2>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-32 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              {mounted && (
                <button
                  onClick={toggleTheme}
                  className="relative p-2 hover:bg-muted rounded-md transition-colors"
                  aria-label="Toggle theme"
                >
                  <Sun className="h-4 w-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                  <Moon className="absolute h-4 w-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0 top-2 left-2" />
                </button>
              )}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span
                  className={`text-sm font-mono ${
                    timeInSeconds < 0 ? "text-red-500" : "text-foreground"
                  }`}
                >
                  {formatTime(timeInSeconds)}
                </span>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleEndInterviewClick}
                disabled={isEndingInterview}
              >
                {isEndingInterview ? "Ending..." : "End Interview"}
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Loading editor...
                </p>
              </div>
            ) : problemData ? (
              <Editor
                language={language}
                defaultValue={problemData.starter_code}
                onChange={handleCodeChange}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Failed to load problem
                </p>
              </div>
            )}
          </div>
        </div>

        <div
          className={`${rightCollapsed ? "w-12" : "w-[420px]"} transition-all duration-300 border-l border-border/50 flex flex-col bg-muted/5 flex-shrink-0`}
        >
          {rightCollapsed ? (
            <button
              onClick={() => setRightCollapsed(false)}
              className="h-full w-full flex items-center justify-center hover:bg-muted/30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
            <>
              <div className="h-14 flex items-center justify-between px-6 border-b border-border/50">
                <h2 className="text-sm font-medium">Transcript</h2>
                <button
                  onClick={() => setRightCollapsed(true)}
                  className="p-1 hover:bg-muted rounded-md transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <TranscriptPanel messages={transcriptMessages} />
              {vapiError && (
                <div className="px-6 py-2 text-xs text-red-500 border-t border-border/50">
                  {vapiError}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog
        open={showEndConfirmation}
        onOpenChange={setShowEndConfirmation}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Interview?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to end the interview? This action cannot be
              undone and you will be redirected to your scores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelEndInterview}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleConfirmEndInterview}
              disabled={isEndingInterview}
            >
              {isEndingInterview ? "Ending..." : "End Interview"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function InterviewPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading interview...</p>
      </div>
    }>
      <InterviewContent />
    </Suspense>
  );
}
