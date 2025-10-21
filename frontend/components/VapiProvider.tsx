"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import Vapi from "@vapi-ai/web";
import { getSessionId } from "@/lib/sessionId";

interface TranscriptSegment {
  type: "transcript" | "call-start" | "call-end";
  role?: "user" | "assistant";
  text?: string;
  timestamp: string;
  secondsSinceStart: number;
}

interface VapiMessage {
  type: string;
  transcriptType?: string;
  role?: string;
  transcript?: string;
}

interface VapiContextType {
  vapi: Vapi | null;
  isCallActive: boolean;
  isSpeaking: boolean;
  startCall: (metadata?: Record<string, unknown>) => Promise<void>;
  endCall: () => Promise<void>;
  sendCodeContext: (
    code: string,
    language: string,
    problemTitle: string,
  ) => void;
  sendProblemContext: (problemData: {
    title: string;
    difficulty?: string;
    description: string;
    example_test_case?: Record<string, unknown>;
  }) => void;
  error: string | null;
  transcript: TranscriptSegment[];
}

const VapiContext = createContext<VapiContextType | undefined>(undefined);

export function VapiProvider({ children }: { children: ReactNode }) {
  const [vapi, setVapi] = useState<Vapi | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const callStartTimeRef = useRef<number | null>(null);
  const callMetadataRef = useRef<Record<string, unknown> | undefined>(
    undefined,
  );

  // Function to upload transcript to backend
  const uploadTranscript = async (
    transcriptData: TranscriptSegment[],
    metadata?: Record<string, unknown>,
  ) => {
    try {
      console.log("Uploading transcript to backend...");
      const response = await fetch(
        "https://harvardapi.codestacx.com/api/transcript",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transcript: transcriptData,
            metadata: metadata || {},
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to upload transcript: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("✅ Transcript uploaded successfully:", result);
      return result;
    } catch (err) {
      console.error("❌ Error uploading transcript:", err);
      throw err;
    }
  };

  // Initialize Vapi instance on mount
  useEffect(() => {
    const vapiInstance = new Vapi(
      process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || "",
    );
    setVapi(vapiInstance);

    // Set up event listeners
    vapiInstance.on("call-start", () => {
      console.log("Call started");
      const now = Date.now();
      callStartTimeRef.current = now;
      setIsCallActive(true);
      setError(null);
      setTranscript([
        {
          type: "call-start",
          timestamp: new Date(now).toISOString(),
          secondsSinceStart: 0,
        },
      ]);
    });

    vapiInstance.on("call-end", () => {
      console.log("Call ended");
      const now = Date.now();
      const secondsSinceStart = callStartTimeRef.current
        ? (now - callStartTimeRef.current) / 1000
        : 0;
      setTranscript((prev) => {
        const finalTranscript: TranscriptSegment[] = [
          ...prev,
          {
            type: "call-end" as const,
            timestamp: new Date(now).toISOString(),
            secondsSinceStart,
          },
        ];
        // Print the complete transcript to console
        console.log(
          "📝 Call Transcript:",
          JSON.stringify(finalTranscript, null, 2),
        );

        // Upload transcript to backend with duration in metadata
        const metadataWithDuration = {
          ...callMetadataRef.current,
          duration: secondsSinceStart,
        };
        uploadTranscript(finalTranscript, metadataWithDuration);

        return finalTranscript;
      });
      setIsCallActive(false);
      callStartTimeRef.current = null;
      callMetadataRef.current = undefined;
    });

    vapiInstance.on("error", (err) => {
      console.error("Vapi error:", err);
      setError(err.message || "An error occurred");
      setIsCallActive(false);
    });

    vapiInstance.on("speech-start", () => {
      console.log("Agent started speaking");
      setIsSpeaking(true);
    });

    vapiInstance.on("speech-end", () => {
      console.log("Agent stopped speaking");
      setIsSpeaking(false);
    });

    // Listen for message events to capture transcript
    vapiInstance.on("message", (message: VapiMessage) => {
      try {
        // Log all message types for debugging
        if (message.type !== "transcript") {
          console.log("📨 Vapi message:", message.type);
        }
        
        // Only process transcript messages, ignore function calls and other types
        if (message.type === "transcript" && message.transcriptType === "final") {
          const now = Date.now();
          const secondsSinceStart = callStartTimeRef.current
            ? (now - callStartTimeRef.current) / 1000
            : 0;

          const segment: TranscriptSegment = {
            type: "transcript",
            role: message.role === "user" ? "user" : "assistant",
            text: message.transcript || "",
            timestamp: new Date(now).toISOString(),
            secondsSinceStart,
          };

          setTranscript((prev) => [...prev, segment]);
        }
      } catch (error) {
        console.error("Error handling message:", error);
        // Don't crash the call, just log the error
      }
    });

    // Cleanup on unmount
    return () => {
      vapiInstance.stop();
    };
  }, []);

  const startCall = useCallback(
    async (metadata?: Record<string, unknown>) => {
      if (!vapi) {
        setError("Vapi is not initialized");
        return;
      }

      const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
      if (!assistantId) {
        setError("Assistant ID not configured");
        return;
      }

      try {
        setError(null);
        // Store metadata for later use when uploading transcript
        callMetadataRef.current = metadata;
        
        // Create assistant overrides to inject problem context via variableValues
        const assistantOverrides: Record<string, unknown> = {};
        
        // If we have problem data, pass it as variables to the dashboard system prompt
        if (metadata && metadata.problemTitle) {
          assistantOverrides.variableValues = {
            problemTitle: metadata.problemTitle || '',
            problemDifficulty: metadata.problemDifficulty || 'Unknown',
            problemDescription: metadata.problemDescription || '',
            exampleInput: metadata.exampleInput || '',
            exampleOutput: metadata.exampleOutput || '',
            exampleExplanation: metadata.exampleExplanation || '',
          };
          
          console.log("📋 Passing problem variables to Oscar:");
          console.log(`   Title: ${metadata.problemTitle}`);
          console.log(`   Difficulty: ${metadata.problemDifficulty}`);
          console.log(`   Has example: ${metadata.exampleInput ? 'Yes' : 'No'}`);
        }
        
        // Start call with variable overrides
        await vapi.start(assistantId, assistantOverrides);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to start call";
        setError(errorMessage);
        console.error("Failed to start call:", err);
      }
    },
    [vapi],
  );

  const endCall = useCallback(async () => {
    if (!vapi) return;

    try {
      vapi.stop();
      setIsCallActive(false);

      // Wait a moment for the call-end event to process and transcript to finalize
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error("Failed to end call:", err);
    }
  }, [vapi]);

  /**
   * Send code context using Vapi metadata (invisible to conversation)
   * Metadata is accessible to AI but doesn't appear in chat transcript
   * Includes session ID to isolate users in multi-user environments
   */
  const sendCodeContext = useCallback(
    (code: string, language: string, problem: string) => {
      if (!vapi || !isCallActive) {
        console.log("⚠️  Cannot send code: Call not active");
        return;
      }

      try {
        const sessionId = getSessionId(); // Get unique session ID for this browser tab
        const lines = code.split("\n").length;
      
        console.log("📤 Sending code context to Oscar");
        console.log(`   Session: ${sessionId}`);
        console.log(`   Problem: ${problem}`);
        console.log(`   Language: ${language}`);
        console.log(`   Code length: ${code.length} chars, ${lines} lines`);

        // Send code as system message content (not metadata)
        // This ensures Oscar can actually see and reference the code
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vapi as any).send({
          type: "add-message",
          message: {
            role: "system",
            content: `[LIVE CODE UPDATE - "${problem}"]

The candidate's CURRENT code on screen (${language}, ${lines} lines):

\`\`\`${language}
${code}
\`\`\`

IMPORTANT: When asked "what am I doing?" or "what's my approach?", reference the EXACT code above. Read the actual lines of code carefully before responding. Do not make assumptions - describe what you actually see in the code block.`,
          },
        });

        console.log("✅ Code sent to Oscar as system message");
      } catch (error) {
        console.error("❌ Failed to send code context:", error);
      }
    },
    [vapi, isCallActive],
  );

  /**
   * Send problem context to Oscar so he knows what question to discuss
   * This is sent as a system message (visible to assistant) on call start
   */
  const sendProblemContext = useCallback(
    (problemData: {
      title: string;
      difficulty?: string;
      description: string;
      example_test_case?: Record<string, unknown>;
    }) => {
      if (!vapi || !isCallActive) {
        console.log("⚠️  Cannot send problem: Call not active");
        return;
      }

      try {
        console.log("📋 Sending problem context to Oscar");
        console.log(`   Problem: ${problemData.title}`);
        console.log(`   Difficulty: ${problemData.difficulty || 'Unknown'}`);

        // Format example test case for readability
        let exampleText = "";
        if (problemData.example_test_case) {
          const example = problemData.example_test_case;
          exampleText = `\n\nExample:\nInput: ${example.input || 'N/A'}\nOutput: ${example.output || 'N/A'}${example.explanation ? `\nExplanation: ${example.explanation}` : ''}`;
        }

        // Send as system message so Oscar can reference it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vapi as any).send({
          type: "add-message",
          message: {
            role: "system",
            content: `INTERVIEW PROBLEM LOADED:

Title: ${problemData.title}
Difficulty: ${problemData.difficulty || 'Not specified'}

Description:
${problemData.description}${exampleText}

The candidate is now working on this problem. You can reference it naturally in conversation when they ask you about it.`,
          },
        });

        console.log("✅ Problem context sent to Oscar");
      } catch (error) {
        console.error("❌ Failed to send problem context:", error);
      }
    },
    [vapi, isCallActive],
  );

  return (
    <VapiContext.Provider
      value={{
        vapi,
        isCallActive,
        isSpeaking,
        startCall,
        endCall,
        sendCodeContext,
        sendProblemContext,
        error,
        transcript,
      }}
    >
      {children}
    </VapiContext.Provider>
  );
}

export function useVapi() {
  const context = useContext(VapiContext);
  if (context === undefined) {
    throw new Error("useVapi must be used within a VapiProvider");
  }
  return context;
}
