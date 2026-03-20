package main

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	filesRoot       = "./files"
	maxFileSize     = 10 * 1024 * 1024 // 10MB
	maxFilesToScan  = 1000
	readTimeout     = 5 * time.Second
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		ReadTimeout:  readTimeout,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())
	app.Use(logger.New())
	
	// Rate limiting
	app.Use(limiter.New(limiter.Config{
		Max:               20,
		Expiration:        1 * time.Minute,
		LimiterMiddleware: limiter.SlidingWindow{},
	}))

	// Security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Get("/search", searchHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	
	if code >= 500 {
		return c.Status(code).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}
	
	return c.Status(code).JSON(ErrorResponse{
		Error: "Bad request",
	})
}

func searchHandler(c *fiber.Ctx) error {
	regexPattern := c.Query("regex")
	if regexPattern == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	// Compile regex with timeout
	regex, err := compileRegexWithTimeout(regexPattern)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid regex pattern",
		})
	}

	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	// Sanitize and validate directory path
	searchPath, err := sanitizePath(directory)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid directory path",
		})
	}

	// Check if directory exists
	if _, err := os.Stat(searchPath); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Directory not found or inaccessible",
		})
	}

	// Search files
	files, err := searchFiles(searchPath, regex, recursive, directory)
	if err != nil {
		log.Printf("Search error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}

	return c.JSON(SearchResponse{
		Files: files,
	})
}

func compileRegexWithTimeout(pattern string) (*regexp.Regexp, error) {
	type result struct {
		regex *regexp.Regexp
		err   error
	}
	
	ch := make(chan result, 1)
	go func() {
		regex, err := regexp.Compile(pattern)
		ch <- result{regex, err}
	}()
	
	select {
	case res := <-ch:
		return res.regex, res.err
	case <-time.After(100 * time.Millisecond):
		return nil, regexp.ErrInternalError
	}
}

func sanitizePath(directory string) (string, error) {
	// Clean the path
	cleanPath := filepath.Clean(directory)
	
	// Ensure no path traversal
	if strings.Contains(cleanPath, "..") {
		return "", os.ErrPermission
	}
	
	// Construct full path
	fullPath := filepath.Join(filesRoot, cleanPath)
	
	// Resolve to absolute path
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}
	
	// Ensure the path is within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return "", err
	}
	
	if !strings.HasPrefix(absPath, absFilesRoot) {
		return "", os.ErrPermission
	}
	
	return absPath, nil
}

func searchFiles(searchPath string, regex *regexp.Regexp, recursive bool, baseDir string) ([]string, error) {
	var matchingFiles []string
	filesScanned := 0
	
	walkFunc := func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files with errors
		}
		
		// Skip if not recursive and not in root directory
		if !recursive && filepath.Dir(path) != searchPath {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		
		// Skip directories
		if info.IsDir() {
			return nil
		}
		
		// Limit number of files to scan
		filesScanned++
		if filesScanned > maxFilesToScan {
			return filepath.SkipAll
		}
		
		// Skip large files
		if info.Size() > maxFileSize {
			return nil
		}
		
		// Read file content with timeout
		content, err := readFileWithTimeout(path, readTimeout)
		if err != nil {
			return nil // Skip files that can't be read
		}
		
		// Check if content matches regex
		if regex.Match(content) {
			// Get relative path from search directory
			relPath, err := filepath.Rel(searchPath, path)
			if err != nil {
				return nil
			}
			
			// If baseDir was specified, prepend it to the relative path
			if baseDir != "" {
				relPath = filepath.Join(baseDir, relPath)
			}
			
			// Convert to forward slashes for consistency
			relPath = filepath.ToSlash(relPath)
			
			matchingFiles = append(matchingFiles, relPath)
		}
		
		return nil
	}
	
	err := filepath.Walk(searchPath, walkFunc)
	if err != nil && err != filepath.SkipAll {
		return nil, err
	}
	
	return matchingFiles, nil
}

func readFileWithTimeout(path string, timeout time.Duration) ([]byte, error) {
	type result struct {
		content []byte
		err     error
	}
	
	ch := make(chan result, 1)
	go func() {
		content, err := os.ReadFile(path)
		ch <- result{content, err}
	}()
	
	select {
	case res := <-ch:
		return res.content, res.err
	case <-time.After(timeout):
		return nil, os.ErrDeadlineExceeded
	}
}