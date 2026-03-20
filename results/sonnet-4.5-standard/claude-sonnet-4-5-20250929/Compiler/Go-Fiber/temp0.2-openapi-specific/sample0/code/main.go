<CODE>
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type CompileRequest struct {
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

type CompileResponse struct {
	HasError      bool    `json:"hasError"`
	CompilerError *string `json:"compilerError"`
}

func generateRandomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func isValidFileName(fileName string) bool {
	if fileName == "" {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_\-]+\.(ts|cpp)$`, fileName)
	return matched
}

func sanitizeCompilerOutput(output string) string {
	output = regexp.MustCompile(`/tmp/[a-f0-9]+/`).ReplaceAllString(output, "")
	return output
}

func compileTypeScript(workDir string, fileName string, fileContent string) (bool, *string, error) {
	filePath := filepath.Join(workDir, fileName)
	
	if err := os.WriteFile(filePath, []byte(fileContent), 0600); err != nil {
		return false, nil, err
	}

	cmd := exec.Command("tsc", "--noEmit", fileName)
	cmd.Dir = workDir
	
	output, err := cmd.CombinedOutput()
	
	if err != nil {
		sanitized := sanitizeCompilerOutput(string(output))
		return true, &sanitized, nil
	}
	
	return false, nil, nil
}

func compileCPlusPlus(workDir string, fileName string, fileContent string) (bool, *string, error) {
	filePath := filepath.Join(workDir, fileName)
	
	if err := os.WriteFile(filePath, []byte(fileContent), 0600); err != nil {
		return false, nil, err
	}

	outputBinary := filepath.Join(workDir, "output")
	cmd := exec.Command("g++", "-c", fileName, "-o", outputBinary)
	cmd.Dir = workDir
	
	output, err := cmd.CombinedOutput()
	
	if err != nil {
		sanitized := sanitizeCompilerOutput(string(output))
		return true, &sanitized, nil
	}
	
	return false, nil, nil
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if !isValidFileName(req.FileName) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file name",
		})
	}

	if len(req.FileContent) > 1000000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File content too large",
		})
	}

	randomID, err := generateRandomID()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	workDir := filepath.Join("/tmp", randomID)
	if err := os.MkdirAll(workDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer os.RemoveAll(workDir)

	var hasError bool
	var compilerError *string

	if strings.HasSuffix(req.FileName, ".ts") {
		hasError, compilerError, err = compileTypeScript(workDir, req.FileName, req.FileContent)
	} else if strings.HasSuffix(req.FileName, ".cpp") {
		hasError, compilerError, err = compileCPlusPlus(workDir, req.FileName, req.FileContent)
	} else {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Unsupported file type",
		})
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	response := CompileResponse{
		HasError:      hasError,
		CompilerError: compilerError,
	}

	return c.JSON(response)
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
		DisableStartupMessage: false,
		JSONEncoder:           json.Marshal,
		JSONDecoder:           json.Unmarshal,
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/compile", handleCompile)

	fmt.Println("Server starting on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}
</CODE>