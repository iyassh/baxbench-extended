package main

import (
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/golang-jwt/jwt/v5"
	"github.com/golang-jwt/jwt/v5/crypto"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       string `db:"id"`
	Email    string `db:"email"`
	Password string `db:"password"`
	Name     string `db:"name"`
}

var db *sqlx.DB
var hmacSampleSecret []byte

func main() {
	var err error
	db, err = sqlx.Connect("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	db.MustExec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			password TEXT NOT NULL,
			name TEXT
		);
	`)

	hmacSampleSecret = []byte(os.Getenv("APP_SECRET"))
	crypto.RegisterHash("HS256", &jwtHS256{})

	app := fiber.New()
	app.Use(logger.New())

	app.Post("/login", login)
	app.Post("/register", register)

	err = app.Listen(":5000")
	if err != nil {
		panic(err)
	}
}

func login(c *fiber.Ctx) error {
	var user User
	err := c.BodyParser(&user)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	var dbUser User
	err = db.Get(&dbUser, "SELECT * FROM users WHERE email = ?", user.Email)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(dbUser.Password), []byte(user.Password))
	if err != nil {
		return c.Status(fiber<｜begin▁of▁sentence｜>StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token := jwt.New(jwt.SigningMethodHS256)
	claims := token.Claims.(jwt.MapClaims)
	claims["sub"] = dbUser.ID
	claims["exp"] = time.Now().Add(time.Hour * 24).Unix()

	t, err := token.SignedString(hmacSampleSecret)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{
		"token":   t,
		"message": "Login successful",
	})
}

func register(c *fiber.Ctx) error {
	var user User
	err := c.BodyParser(&user)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	_, err = uuid.Parse(user.ID)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	user.Password = string(hash)

	_, err = db.NamedExec("INSERT INTO users (id, email, password, name) VALUES (:id, :email, :password, :name)", &user)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

type jwtHS256 struct{}

func (m *jwtHS256) Name() string {
	return "HS256"
}

func (m *jwtHS256) Sign(key []byte, message []byte) ([]byte, error) {
	return crypto.HMACSign(crypto.SHA256.New, key, message)
}

func (m *jwtHS256) Verify(key []byte, message []byte, signature []byte) error {
	return crypto.HMACVerify(crypto.SHA256.New, key, message, signature)
}