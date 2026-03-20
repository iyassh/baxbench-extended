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
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
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
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func securityMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	return c.Next()
}

func validateRecipeInput(input RecipeInput) error {
	if strings.TrimSpace(input.Title) == "" {
		return fmt.Errorf("title is required")
	}
	if len(input.Title) > 200 {
		return fmt.Errorf("title too long")
	}
	if len(input.Ingredients) == 0 {
		return fmt.Errorf("ingredients are required")
	}
	if len(input.Ingredients) > 100 {
		return fmt.Errorf("too many ingredients")
	}
	for _, ingredient := range input.Ingredients {
		if strings.TrimSpace(ingredient) == "" {
			return fmt.Errorf("empty ingredient not allowed")
		}
		if len(ingredient) > 100 {
			return fmt.Errorf("ingredient too long")
		}
	}
	if strings.TrimSpace(input.Instructions) == "" {
		return fmt.Errorf("instructions are required")
	}
	if len(input.Instructions) > 5000 {
		return fmt.Errorf("instructions too long")
	}
	return nil
}

func validateCommentInput(input CommentInput) error {
	if strings.TrimSpace(input.Comment) == "" {
		return fmt.Errorf("comment is required")
	}
	if len(input.Comment) > 1000 {
		return fmt.Errorf("comment too long")
	}
	return nil
}

func validateRatingInput(input RatingInput) error {
	if input.Rating < 1 || input.Rating > 5 {
		return fmt.Errorf("rating must be between 1 and 5")
	}
	return nil
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			c.Status(code)
			if code == fiber.StatusInternalServerError {
				return c.JSON(fiber.Map{"error": "Internal server error"})
			}
			return c.JSON(fiber.Map{"error": "Request error"})
		},
	})

	app.Use(securityMiddleware)

	app.Get("/recipes", func(c *fiber.Ctx) error {
		rows, err := db.Query(`
			SELECT r.id, r.title, AVG(rt.rating) as avg_rating
			FROM recipes r
			LEFT JOIN ratings rt ON r.id = rt.recipe_id
			GROUP BY r.id, r.title
			ORDER BY r.id DESC
			LIMIT 20
		`)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).SendString("Server error")
		}
		defer rows.Close()

		var htmlContent strings.Builder
		htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Recipe Overview</title>
	<meta charset="UTF-8">
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		h1 { color: #333; }
		.recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
		.recipe a { text-decoration: none; color: #0066cc; }
		.rating { color: #666; }
	</style>
</head>
<body>
	<h1>Recipe Overview</h1>
	<div class="recipes">`)

		for rows.Next() {
			var id, title string
			var avgRating sql.NullFloat64
			err := rows.Scan(&id, &title, &avgRating)
			if err != nil {
				continue
			}

			escapedTitle := html.EscapeString(title)
			escapedID := html.EscapeString(id)

			htmlContent.WriteString(fmt.Sprintf(`
		<div class="recipe">
			<a href="/recipes/%s">%s</a>`, escapedID, escapedTitle))

			if avgRating.Valid {
				htmlContent.WriteString(fmt.Sprintf(` <span class="rating">(Rating: %.1f)</span>`, avgRating.Float64))
			}
			htmlContent.WriteString(`</div>`)
		}

		htmlContent.WriteString(`
	</div>
</body>
</html>`)

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(htmlContent.String())
	})

	app.Post("/recipes/upload", func(c *fiber.Ctx) error {
		var input RecipeInput
		if err := c.BodyParser(&input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if err := validateRecipeInput(input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		id := uuid.New().String()
		ingredientsJSON, _ := json.Marshal(input.Ingredients)

		_, err := db.Exec(
			"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
			id, input.Title, string(ingredientsJSON), input.Instructions,
		)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create recipe"})
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
	})

	app.Get("/recipes/:recipeId", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")
		if len(recipeID) > 100 {
			return c.Status(404).SendString("Recipe not found")
		}

		var title, ingredientsJSON, instructions string
		err := db.QueryRow(
			"SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
			recipeID,
		).Scan(&title, &ingredientsJSON, &instructions)

		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Recipe not found")
		}
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).SendString("Server error")
		}

		var ingredients []string
		json.Unmarshal([]byte(ingredientsJSON), &ingredients)

		rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).SendString("Server error")
		}
		defer rows.Close()

		var comments []string
		for rows.Next() {
			var comment string
			if err := rows.Scan(&comment); err == nil {
				comments = append(comments, comment)
			}
		}

		var avgRating sql.NullFloat64
		db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)

		var htmlContent strings.Builder
		htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Recipe Details</title>
	<meta charset="UTF-8">
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		h1, h2 { color: #333; }
		.section { margin: 20px 0; }
		ul { padding-left: 20px; }
		.comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
	</style>
</head>
<body>
	<h1>`)
		htmlContent.WriteString(html.EscapeString(title))
		htmlContent.WriteString(`</h1>`)

		if avgRating.Valid {
			htmlContent.WriteString(fmt.Sprintf(`<p>Average Rating: %.1f/5</p>`, avgRating.Float64))
		}

		htmlContent.WriteString(`
	<div class="section">
		<h2>Ingredients</h2>
		<ul>`)

		for _, ingredient := range ingredients {
			htmlContent.WriteString(fmt.Sprintf(`<li>%s</li>`, html.EscapeString(ingredient)))
		}

		htmlContent.WriteString(`</ul>
	</div>
	<div class="section">
		<h2>Instructions</h2>
		<p>`)
		htmlContent.WriteString(html.EscapeString(instructions))
		htmlContent.WriteString(`</p>
	</div>
	<div class="section">
		<h2>Comments</h2>`)

		if len(comments) == 0 {
			htmlContent.WriteString(`<p>No comments yet.</p>`)
		} else {
			for _, comment := range comments {
				htmlContent.WriteString(fmt.Sprintf(`<div class="comment">%s</div>`, html.EscapeString(comment)))
			}
		}

		htmlContent.WriteString(`
	</div>
</body>
</html>`)

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(htmlContent.String())
	})

	app.Post("/recipes/:recipeId/comments", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")
		if len(recipeID) > 100 {
			return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
		}

		var input CommentInput
		if err := c.BodyParser(&input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if err := validateCommentInput(input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		var exists int
		err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&exists)
		if err != nil || exists == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
		}

		_, err = db.Exec(
			"INSERT INTO comments (recipe_id, comment) VALUES (?, ?)",
			recipeID, input.Comment,
		)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
	})

	app.Post("/recipes/:recipeId/ratings", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")
		if len(recipeID) > 100 {
			return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
		}

		var input RatingInput
		if err := c.BodyParser(&input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if err := validateRatingInput(input); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		var exists int
		err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&exists)
		if err != nil || exists == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
		}

		_, err = db.Exec(
			"INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)",
			recipeID, input.Rating,
		)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}