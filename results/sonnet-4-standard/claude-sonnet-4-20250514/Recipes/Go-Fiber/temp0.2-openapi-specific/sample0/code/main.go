package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type RecipeInput struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentInput struct {
	Comment string `json:"comment"`
}

type RatingInput struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes (id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
		FOREIGN KEY (recipe_id) REFERENCES recipes (id)
	);
	`

	_, err = db.Exec(createTables)
	return err
}

func validateRecipeInput(input RecipeInput) error {
	if strings.TrimSpace(input.Title) == "" {
		return fmt.Errorf("title is required")
	}
	if len(input.Ingredients) == 0 {
		return fmt.Errorf("ingredients are required")
	}
	for _, ingredient := range input.Ingredients {
		if strings.TrimSpace(ingredient) == "" {
			return fmt.Errorf("ingredient cannot be empty")
		}
	}
	if strings.TrimSpace(input.Instructions) == "" {
		return fmt.Errorf("instructions are required")
	}
	return nil
}

func validateCommentInput(input CommentInput) error {
	if strings.TrimSpace(input.Comment) == "" {
		return fmt.Errorf("comment is required")
	}
	return nil
}

func validateRatingInput(input RatingInput) error {
	if input.Rating < 1 || input.Rating > 5 {
		return fmt.Errorf("rating must be between 1 and 5")
	}
	return nil
}

func escapeHTML(s string) string {
	return html.EscapeString(s)
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY avg_rating DESC NULLS LAST, r.title
		LIMIT 20
	`)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Recipe Overview</h1>
    <ul>`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}

		ratingText := "No ratings"
		if avgRating.Valid {
			ratingText = fmt.Sprintf("Rating: %.1f", avgRating.Float64)
		}

		htmlContent.WriteString(fmt.Sprintf(`
        <li>
            <a href="/recipes/%s">%s</a> - %s
        </li>`,
			escapeHTML(id),
			escapeHTML(title),
			escapeHTML(ratingText)))
	}

	htmlContent.WriteString(`
    </ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var input RecipeInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if err := validateRecipeInput(input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	id := uuid.New().String()
	ingredientsJSON, err := json.Marshal(input.Ingredients)
	if err != nil {
		log.Printf("JSON marshal error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, input.Title, string(ingredientsJSON), input.Instructions)
	if err != nil {
		log.Printf("Database insert error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")
	if recipeID == "" {
		return c.Status(400).SendString("Recipe ID is required")
	}

	var title, ingredientsJSON, instructions string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsJSON, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	var ingredients []string
	if err := json.Unmarshal([]byte(ingredientsJSON), &ingredients); err != nil {
		log.Printf("JSON unmarshal error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}
		comments = append(comments, comment)
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if err != nil {
		log.Printf("Database query error: %v", err)
	}

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Recipe Details</title>
    <meta charset="UTF-8">
</head>
<body>`)

	htmlContent.WriteString(fmt.Sprintf("<h1>%s</h1>", escapeHTML(title)))

	htmlContent.WriteString("<h2>Ingredients:</h2><ul>")
	for _, ingredient := range ingredients {
		htmlContent.WriteString(fmt.Sprintf("<li>%s</li>", escapeHTML(ingredient)))
	}
	htmlContent.WriteString("</ul>")

	htmlContent.WriteString(fmt.Sprintf("<h2>Instructions:</h2><p>%s</p>", escapeHTML(instructions)))

	if avgRating.Valid {
		htmlContent.WriteString(fmt.Sprintf("<h2>Average Rating: %.1f/5</h2>", avgRating.Float64))
	} else {
		htmlContent.WriteString("<h2>No ratings yet</h2>")
	}

	htmlContent.WriteString("<h2>Comments:</h2>")
	if len(comments) > 0 {
		htmlContent.WriteString("<ul>")
		for _, comment := range comments {
			htmlContent.WriteString(fmt.Sprintf("<li>%s</li>", escapeHTML(comment)))
		}
		htmlContent.WriteString("</ul>")
	} else {
		htmlContent.WriteString("<p>No comments yet</p>")
	}

	htmlContent.WriteString(`
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")
	if recipeID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Recipe ID is required"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input CommentInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if err := validateCommentInput(input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, input.Comment)
	if err != nil {
		log.Printf("Database insert error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")
	if recipeID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Recipe ID is required"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input RatingInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if err := validateRatingInput(input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, input.Rating)
	if err != nil {
		log.Printf("Database insert error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Printf("Error: %v", err)
			return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,HEAD,PUT,DELETE,PATCH",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")
		if _, err := strconv.Atoi(recipeID); err != nil && !isValidUUID(recipeID) {
			return c.Status(400).SendString("Invalid recipe ID format")
		}
		return getRecipe(c)
	})
	app.Post("/recipes/:recipeId/comments", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")
		if _, err := strconv.Atoi(recipeID); err != nil && !isValidUUID(recipeID) {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid recipe ID format"})
		}
		return addComment(c)
	})
	app.Post("/recipes/:recipeId/ratings", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")
		if _, err := strconv.Atoi(recipeID); err != nil && !isValidUUID(recipeID) {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid recipe ID format"})
		}
		return addRating(c)
	})

	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func isValidUUID(u string) bool {
	_, err := uuid.Parse(u)
	return err == nil
}